"""Single Sign-On and User lifecycle integration for Engineering OS."""

import os
import frappe
from frappe import _
from acs_erp.passcodec import decode_and_verify, PassError

MANAGED_ROLES = {
    'System Manager',
    'Sales Manager',
    'Sales User',
    'Sales Master Manager',
    'Purchase Manager',
    'Purchase User',
    'Purchase Master Manager',
    'Stock Manager',
    'Stock User',
    'Item Manager',
    'Delivery Manager',
    'Delivery User',
    'Accounts Manager',
    'Accounts User',
    'Manufacturing Manager',
    'Manufacturing User',
    'Quality Manager',
    'Maintenance Manager',
    'Maintenance User',
    'Fleet Manager',
    'Support Team',
}


def _get_secret() -> str:
    secret = frappe.conf.get("acs_erp_sso_secret") or os.environ.get("ERP_SSO_SECRET")
    if not secret:
        frappe.throw(_("acs_erp_sso_secret is not configured on this site."))
    return secret


def _fail_login(message: str = "Sign-in link expired. Open ERP again from Engineering OS."):
    frappe.respond_as_web_page(
        title=_("Sign-in Expired"),
        html=(
            f"<div style='text-align: center; padding: 48px; font-family: Inter, sans-serif; color: #1a1a19;'>"
            f"<h2 style='font-size: 20px; font-weight: 500; margin-bottom: 12px;'>Access Notice</h2>"
            f"<p style='color: #6b6b66; font-size: 14px;'>{message}</p>"
            f"</div>"
        ),
        http_status_code=401,
        indicator_color="red",
    )


@frappe.whitelist(allow_guest=True, methods=["POST"])
def login(token: str = None):
    """Guest-allowed SSO login endpoint. Auto-submits from Engineering OS."""
    # Frappe maps form fields to function arguments or frappe.form_dict
    raw_pass = token or frappe.form_dict.get("pass") or frappe.form_dict.get("token")
    if not raw_pass:
        return _fail_login()

    try:
        secret = _get_secret()
        payload = decode_and_verify(raw_pass, secret, expected_act="login")
    except Exception as e:
        frappe.logger("acs_erp").warning(f"SSO verification failed: {e}")
        return _fail_login()

    nonce = payload.get("nonce")
    cache_key = f"acs_erp_nonce:{nonce}"
    if frappe.cache().get_value(cache_key):
        frappe.logger("acs_erp").warning(f"Replay attempt for nonce {nonce}")
        return _fail_login()

    # Mark nonce single-use for 120s
    frappe.cache().set_value(cache_key, 1, expires_in_sec=120)

    email = payload.get("email", "").strip().lower()
    if not email:
        return _fail_login()

    # Get or create the User
    if not frappe.db.exists("User", email):
        full_name = payload.get("name", "").strip() or email.split("@")[0]
        user_doc = frappe.get_doc({
            "doctype": "User",
            "email": email,
            "first_name": full_name,
            "enabled": 1,
            "user_type": "System User",
            "send_welcome_email": 0,
        })
        user_doc.flags.ignore_password_policy = True
        user_doc.insert(ignore_permissions=True)
    else:
        user_doc = frappe.get_doc("User", email)
        # Security check: never allow SSO into privileged accounts, integration users with API keys, or non-System User
        existing_roles = {r.role for r in user_doc.roles}
        if "Administrator" in existing_roles:
            frappe.logger("acs_erp").error(f"SSO refused for Administrator account: {email}")
            return _fail_login()

        if getattr(user_doc, "api_key", None):
            frappe.logger("acs_erp").error(f"SSO refused for integration user with API key: {email}")
            return _fail_login()

        if user_doc.user_type != "System User":
            frappe.logger("acs_erp").error(f"SSO refused for non-System User: {email} (type: {user_doc.user_type})")
            return _fail_login()

        if not user_doc.enabled:
            user_doc.enabled = 1


    # Map roles: strictly within MANAGED_ROLES, never Administrator or Guest
    pass_roles = set(payload.get("roles", []))
    desired_managed_roles = pass_roles.intersection(MANAGED_ROLES)

    # Retain non-managed roles, overwrite managed roles
    roles_to_keep = [r for r in user_doc.roles if r.role not in MANAGED_ROLES]
    user_doc.roles = roles_to_keep
    for r in desired_managed_roles:
        user_doc.append("roles", {"role": r})

    user_doc.save(ignore_permissions=True)
    frappe.db.commit()

    # Log in as user and redirect to Desk
    frappe.local.login_manager.login_as(email)
    frappe.local.response["type"] = "redirect"
    frappe.local.response["location"] = "/app"


@frappe.whitelist(allow_guest=True, methods=["POST"])
def disable_user(token: str = None):
    """Server-to-server endpoint to disable a user and end their active sessions."""
    raw_pass = token or frappe.form_dict.get("pass") or frappe.form_dict.get("token")
    if not raw_pass:
        frappe.throw(_("Missing SSO pass"), frappe.AuthenticationError)

    secret = _get_secret()
    payload = decode_and_verify(raw_pass, secret, expected_act="disable")

    nonce = payload.get("nonce")
    cache_key = f"acs_erp_nonce:{nonce}"
    if frappe.cache().get_value(cache_key):
        frappe.throw(_("SSO pass already used"), frappe.AuthenticationError)

    frappe.cache().set_value(cache_key, 1, expires_in_sec=120)

    email = payload.get("email", "").strip().lower()
    if not email:
        frappe.throw(_("Invalid email"))

    if frappe.db.exists("User", email):
        user_doc = frappe.get_doc("User", email)
        user_doc.enabled = 0
        user_doc.save(ignore_permissions=True)

        # Clear all active sessions for this user
        from frappe.sessions import clear_sessions
        clear_sessions(user=email)
        frappe.db.commit()

    return {"status": "ok", "email": email}
