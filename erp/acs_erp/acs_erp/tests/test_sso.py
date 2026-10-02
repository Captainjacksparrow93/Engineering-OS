import os
import sys
import time
import types
import unittest
from unittest.mock import MagicMock

# Ensure both package root and parent are on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))


class FakeAuthenticationError(Exception):
    pass


class FakeRoleRow:
    def __init__(self, role: str):
        self.role = role


class FakeUserDoc:
    def __init__(self, data: dict, db):
        self._db = db
        self.doctype = "User"
        self.email = data["email"].strip().lower()
        self.first_name = data.get("first_name", "")
        self.enabled = data.get("enabled", 1)
        self.user_type = data.get("user_type", "System User")
        self.send_welcome_email = data.get("send_welcome_email", 0)
        self.api_key = data.get("api_key", None)
        self.roles = [
            FakeRoleRow(r["role"] if isinstance(r, dict) else r.role)
            for r in data.get("roles", [])
        ]
        self.flags = types.SimpleNamespace(ignore_password_policy=False)

    def append(self, fieldname: str, val: dict):
        if fieldname == "roles":
            self.roles.append(FakeRoleRow(val["role"]))

    def insert(self, ignore_permissions: bool = False):
        self._db.users[self.email] = self
        return self

    def save(self, ignore_permissions: bool = False):
        self._db.users[self.email] = self
        return self


class FakeField:
    def __init__(self, fieldname: str, hidden: int = 0):
        self.fieldname = fieldname
        self.hidden = hidden


class FakeMeta:
    def __init__(self, fields: dict):
        self._fields = fields

    def has_field(self, fieldname: str) -> bool:
        return fieldname in self._fields

    def get_field(self, fieldname: str):
        return self._fields.get(fieldname)


class FakeState:
    def __init__(self):
        self.cache_store = {}
        self.users = {}
        self.doctypes = {
            "Sales Order": FakeMeta({"project": FakeField("project", hidden=0)}),
            "Quotation": FakeMeta({"project": FakeField("project", hidden=0)}),
            "Sales Invoice": FakeMeta({"project": FakeField("project", hidden=0)}),
            "Purchase Order": FakeMeta({"project": FakeField("project", hidden=0)}),
            "Custom DocPerm": FakeMeta({}),
        }
        self.desktop_icons = {"Projects": {"hidden": 0}}
        self.workspaces = {"Projects": {"is_hidden": 0}}
        self.property_setters = {}
        self.logged_in_user = None
        self.cleared_sessions_for = []
        self.web_page_response = None


# Set up fake frappe in sys.modules before importing acs_erp.sso
mock_frappe = sys.modules.get("frappe") or MagicMock()
mock_frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn)
mock_frappe._ = lambda s: s
mock_frappe.AuthenticationError = FakeAuthenticationError

mock_sessions = MagicMock()
sys.modules["frappe"] = mock_frappe
sys.modules["frappe.sessions"] = mock_sessions

from acs_erp.passcodec import encode_pass
from acs_erp import sso
from acs_erp.install import _hide_projects_module


TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

DIRECTOR_ROLES = [
    "System Manager",
    "Sales Manager",
    "Sales User",
    "Sales Master Manager",
    "Purchase Manager",
    "Purchase User",
    "Purchase Master Manager",
    "Stock Manager",
    "Stock User",
    "Item Manager",
    "Delivery Manager",
    "Delivery User",
    "Accounts Manager",
    "Accounts User",
    "Manufacturing Manager",
    "Manufacturing User",
    "Quality Manager",
    "Maintenance Manager",
    "Maintenance User",
    "Fleet Manager",
    "Support Team",
]

SALES_HEAD_ROLES = [r for r in DIRECTOR_ROLES if r != "System Manager"]


class TestSsoLoginAndLifecycle(unittest.TestCase):
    def setUp(self):
        self.state = FakeState()
        self._nonce_counter = 0

        mock_frappe.reset_mock()
        mock_frappe.AuthenticationError = FakeAuthenticationError
        mock_frappe._ = lambda s: s
        mock_frappe.conf = {"acs_erp_sso_secret": TEST_SECRET}
        mock_frappe.form_dict = {}

        # Cache
        cache_obj = MagicMock()
        cache_obj.get_value.side_effect = lambda k: self.state.cache_store.get(k)
        cache_obj.set_value.side_effect = lambda k, v, expires_in_sec=None: self.state.cache_store.__setitem__(k, v)
        mock_frappe.cache.return_value = cache_obj

        # DB
        def db_exists(dt, name=None):
            if dt == "User":
                return name.strip().lower() in self.state.users
            if dt == "DocType":
                return name in self.state.doctypes
            if dt == "Desktop Icon":
                return name in self.state.desktop_icons
            return False

        def db_set_value(dt, name, field, val, update_modified=True):
            if dt == "Desktop Icon" and name in self.state.desktop_icons:
                self.state.desktop_icons[name][field] = val
            elif dt == "Workspace" and name in self.state.workspaces:
                self.state.workspaces[name][field] = val

        mock_frappe.db = MagicMock()
        mock_frappe.db.exists.side_effect = db_exists
        mock_frappe.db.set_value.side_effect = db_set_value

        # get_all for Workspaces
        mock_frappe.get_all.side_effect = lambda dt, filters=None: (
            [types.SimpleNamespace(name="Projects")] if dt == "Workspace" else []
        )

        # get_doc
        def get_doc(arg1, arg2=None):
            if isinstance(arg1, dict) and arg1.get("doctype") == "User":
                return FakeUserDoc(arg1, self.state)
            if arg1 == "User" and isinstance(arg2, str):
                return self.state.users[arg2.strip().lower()]
            raise KeyError(f"Unexpected get_doc({arg1}, {arg2})")

        mock_frappe.get_doc.side_effect = get_doc

        # get_meta & make_property_setter
        mock_frappe.get_meta.side_effect = lambda dt: self.state.doctypes[dt]

        def make_property_setter(args, *a, **kw):
            if not isinstance(args, dict):
                raise TypeError("make_property_setter requires a dict argument")
            dt = args["doctype"]
            fieldname = args["fieldname"]
            prop = args["property"]
            val = args["value"]
            self.state.property_setters[(dt, fieldname, prop)] = val
            if dt in self.state.doctypes and self.state.doctypes[dt].has_field(fieldname):
                if prop == "hidden":
                    self.state.doctypes[dt].get_field(fieldname).hidden = int(val)

        mock_frappe.make_property_setter.side_effect = make_property_setter

        # login_manager and local response
        login_mgr = MagicMock()
        login_mgr.login_as.side_effect = lambda email: setattr(self.state, "logged_in_user", email)
        mock_frappe.local = types.SimpleNamespace(
            login_manager=login_mgr,
            response={},
        )

        # respond_as_web_page
        def respond_as_web_page(title="", html="", http_status_code=200, indicator_color=""):
            self.state.web_page_response = {
                "title": title,
                "html": html,
                "http_status_code": http_status_code,
            }

        mock_frappe.respond_as_web_page.side_effect = respond_as_web_page

        # throw
        def fake_throw(msg, exc=Exception):
            if isinstance(exc, type) and issubclass(exc, BaseException):
                raise exc(msg)
            raise Exception(msg)

        mock_frappe.throw.side_effect = fake_throw

        # clear_sessions
        mock_sessions.clear_sessions.reset_mock()
        mock_sessions.clear_sessions.side_effect = lambda user=None: self.state.cleared_sessions_for.append(user)

    def _make_pass(self, email="director@acsengitech.com", name="Test User", roles=None, act="login", iat=None, exp=None, nonce=None, secret=TEST_SECRET):
        now = int(time.time())
        if iat is None:
            iat = now
        if exp is None:
            exp = iat + 30
        if nonce is None:
            self._nonce_counter += 1
            nonce = f"{self._nonce_counter:032x}"
        payload = {
            "v": 1,
            "act": act,
            "email": email,
            "name": name,
            "roles": roles if roles is not None else DIRECTOR_ROLES,
            "iat": iat,
            "exp": exp,
            "nonce": nonce,
        }
        return encode_pass(payload, secret)

    def test_new_user_created_and_repeat_login_resyncs_roles(self):
        email = "user.sync@acsengitech.com"
        # 1. First sign-in as Director creates the user with all 21 roles
        pass1 = self._make_pass(email=email, name="Sync User", roles=DIRECTOR_ROLES)
        sso.login(token=pass1)

        self.assertIsNone(self.state.web_page_response)
        self.assertEqual(self.state.logged_in_user, email)
        self.assertEqual(mock_frappe.local.response.get("type"), "redirect")
        self.assertEqual(mock_frappe.local.response.get("location"), "/app")

        user_doc = self.state.users[email]
        self.assertEqual(user_doc.enabled, 1)
        self.assertEqual(user_doc.user_type, "System User")
        assigned_roles = {r.role for r in user_doc.roles}
        self.assertEqual(assigned_roles, set(DIRECTOR_ROLES))
        self.assertIn("System Manager", assigned_roles)

        # Add an unmanaged role to confirm repeat login preserves non-managed roles
        user_doc.append("roles", {"role": "Desk User"})

        # 2. Second sign-in for the SAME user with Sales Head roles drops System Manager
        self.state.logged_in_user = None
        mock_frappe.local.response = {}
        pass2 = self._make_pass(email=email, name="Sync User", roles=SALES_HEAD_ROLES)
        sso.login(token=pass2)

        self.assertIsNone(self.state.web_page_response)
        self.assertEqual(self.state.logged_in_user, email)
        self.assertEqual(mock_frappe.local.response.get("location"), "/app")

        updated_roles = {r.role for r in self.state.users[email].roles}
        self.assertNotIn("System Manager", updated_roles)
        self.assertIn("Desk User", updated_roles)
        self.assertTrue(set(SALES_HEAD_ROLES).issubset(updated_roles))

    def test_refuses_administrator_email_and_role(self):
        # 1. Literal 'administrator' email rejected by passcodec
        bad_pass = self._make_pass(email="administrator")
        sso.login(token=bad_pass)
        self.assertIsNotNone(self.state.web_page_response)
        self.assertEqual(self.state.web_page_response["http_status_code"], 401)
        self.assertIsNone(self.state.logged_in_user)

        # 2. Normal email whose ERPNext user holds Administrator role rejected by sso.login
        self.state.web_page_response = None
        admin_email = "root.admin@acsengitech.com"
        FakeUserDoc(
            {
                "email": admin_email,
                "first_name": "Root Admin",
                "user_type": "System User",
                "roles": [{"role": "Administrator"}, {"role": "System Manager"}],
            },
            self.state,
        ).insert()

        pass_admin_role = self._make_pass(email=admin_email)
        sso.login(token=pass_admin_role)
        self.assertIsNotNone(self.state.web_page_response)
        self.assertEqual(self.state.web_page_response["http_status_code"], 401)
        self.assertIsNone(self.state.logged_in_user)

    def test_refuses_user_with_api_key(self):
        api_email = "engos-api@acsengitech.com"
        FakeUserDoc(
            {
                "email": api_email,
                "first_name": "EngOS API",
                "user_type": "System User",
                "api_key": "api_key_secret_token",
                "roles": [{"role": "Sales User"}],
            },
            self.state,
        ).insert()

        token = self._make_pass(email=api_email, roles=SALES_HEAD_ROLES)
        sso.login(token=token)

        self.assertIsNotNone(self.state.web_page_response)
        self.assertEqual(self.state.web_page_response["http_status_code"], 401)
        self.assertIsNone(self.state.logged_in_user)

    def test_refuses_website_user(self):
        web_email = "customer.portal@acsengitech.com"
        FakeUserDoc(
            {
                "email": web_email,
                "first_name": "Portal User",
                "user_type": "Website User",
                "roles": [],
            },
            self.state,
        ).insert()

        token = self._make_pass(email=web_email, roles=SALES_HEAD_ROLES)
        sso.login(token=token)

        self.assertIsNotNone(self.state.web_page_response)
        self.assertEqual(self.state.web_page_response["http_status_code"], 401)
        self.assertIsNone(self.state.logged_in_user)

    def test_refuses_expired_pass(self):
        now = int(time.time())
        expired_token = self._make_pass(
            email="expired@acsengitech.com",
            iat=now - 120,
            exp=now - 90,
        )
        sso.login(token=expired_token)

        self.assertIsNotNone(self.state.web_page_response)
        self.assertEqual(self.state.web_page_response["http_status_code"], 401)
        self.assertIsNone(self.state.logged_in_user)

    def test_refuses_reused_nonce(self):
        token = self._make_pass(
            email="replay@acsengitech.com",
            nonce="aaaa1111bbbb2222cccc3333dddd4444",
        )
        # First use succeeds
        sso.login(token=token)
        self.assertIsNone(self.state.web_page_response)
        self.assertEqual(self.state.logged_in_user, "replay@acsengitech.com")

        # Second use of identical nonce is refused
        self.state.logged_in_user = None
        sso.login(token=token)
        self.assertIsNotNone(self.state.web_page_response)
        self.assertEqual(self.state.web_page_response["http_status_code"], 401)
        self.assertIsNone(self.state.logged_in_user)

    def test_refuses_bad_signature(self):
        token = self._make_pass(email="tampered@acsengitech.com")
        payload_b64, _ = token.split(".")
        tampered = f"{payload_b64}.bad_signature_bytes"

        sso.login(token=tampered)
        self.assertIsNotNone(self.state.web_page_response)
        self.assertEqual(self.state.web_page_response["http_status_code"], 401)
        self.assertIsNone(self.state.logged_in_user)

    def test_disable_user_disables_account_and_clears_sessions(self):
        email = "departing@acsengitech.com"
        # First create/login user
        login_token = self._make_pass(email=email, act="login")
        sso.login(token=login_token)
        self.assertEqual(self.state.users[email].enabled, 1)

        # Now disable via act="disable"
        disable_token = self._make_pass(email=email, act="disable", roles=[])
        res = sso.disable_user(token=disable_token)

        self.assertEqual(res, {"status": "ok", "email": email})
        self.assertEqual(self.state.users[email].enabled, 0)
        self.assertIn(email, self.state.cleared_sessions_for)

    def test_hide_projects_module_leaves_project_field_hidden_on_sales_order(self):
        # Before running _hide_projects_module, Sales Order.project is visible (hidden=0)
        so_meta = mock_frappe.get_meta("Sales Order")
        self.assertEqual(so_meta.get_field("project").hidden, 0)

        _hide_projects_module()

        # After _hide_projects_module, Sales Order.project must be hidden (hidden=1)
        self.assertEqual(so_meta.get_field("project").hidden, 1)
        self.assertEqual(
            self.state.property_setters.get(("Sales Order", "project", "hidden")),
            "1",
        )
        self.assertEqual(self.state.desktop_icons["Projects"]["hidden"], 1)
        self.assertEqual(self.state.workspaces["Projects"]["is_hidden"], 1)


if __name__ == "__main__":
    unittest.main()
