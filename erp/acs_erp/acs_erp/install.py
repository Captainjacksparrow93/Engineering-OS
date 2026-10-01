import frappe


def after_install():
    """Sets system defaults, creates panel items, and ensures custom fields and permissions exist."""
    # 1. Session Expiry 08:00
    try:
        system_settings = frappe.get_doc("System Settings")
        system_settings.session_expiry = "08:00"
        if hasattr(system_settings, "allow_login_using_email_link"):
            system_settings.allow_login_using_email_link = 0
        system_settings.save(ignore_permissions=True)
    except Exception as e:
        frappe.logger("acs_erp").error(f"Failed to update System Settings: {e}")

    # 2. Disable sign-up and set brand name
    try:
        website_settings = frappe.get_doc("Website Settings")
        website_settings.disable_signup = 1
        website_settings.app_name = "Engineering OS · ERP"
        website_settings.save(ignore_permissions=True)
    except Exception as e:
        frappe.logger("acs_erp").error(f"Failed to update Website Settings: {e}")

    try:
        if frappe.db.exists("DocType", "Navbar Settings"):
            navbar = frappe.get_doc("Navbar Settings")
            navbar.app_name = "Engineering OS · ERP"
            navbar.save(ignore_permissions=True)
    except Exception as e:
        frappe.logger("acs_erp").error(f"Failed to update Navbar Settings: {e}")

    # 3. Create PLC, SCADA, HMI Panel Items if missing
    panel_items = [
        {"item_code": "PLC", "item_name": "PLC Panel"},
        {"item_code": "SCADA", "item_name": "SCADA Panel"},
        {"item_code": "HMI", "item_name": "HMI Panel"},
    ]
    for itm in panel_items:
        if not frappe.db.exists("Item", itm["item_code"]):
            try:
                doc = frappe.get_doc({
                    "doctype": "Item",
                    "item_code": itm["item_code"],
                    "item_name": itm["item_name"],
                    "item_group": "All Item Groups",
                    "stock_uom": "Nos",
                    "is_stock_item": 0,
                    "include_item_in_manufacturing": 0,
                })
                doc.insert(ignore_permissions=True)
            except Exception as e:
                frappe.logger("acs_erp").error(f"Failed to create Item {itm['item_code']}: {e}")

    # 4. Ensure EngOS Integration role exists
    if not frappe.db.exists("Role", "EngOS Integration"):
        frappe.get_doc({
            "doctype": "Role",
            "role_name": "EngOS Integration",
            "desk_access": 1,
        }).insert(ignore_permissions=True)

    # 5. Ensure custom fields exist
    _ensure_custom_fields()

    # 6. Ensure docperms exist
    _ensure_docperms()

    frappe.db.commit()


def _ensure_custom_fields():
    custom_fields = [
        {
            "dt": "Sales Order",
            "fieldname": "custom_wo_number",
            "label": "WO Number",
            "fieldtype": "Data",
            "insert_after": "customer",
            "allow_on_submit": 0,
        },
        {
            "dt": "Sales Order",
            "fieldname": "custom_project_code",
            "label": "Project Code",
            "fieldtype": "Data",
            "insert_after": "custom_wo_number",
            "read_only": 1,
            "allow_on_submit": 1,
        },
        {
            "dt": "Sales Order",
            "fieldname": "custom_project_link",
            "label": "Project Link",
            "fieldtype": "Data",
            "insert_after": "custom_project_code",
            "read_only": 1,
            "allow_on_submit": 1,
        },
        {
            "dt": "Customer",
            "fieldname": "custom_acs_reference",
            "label": "ACS Reference",
            "fieldtype": "Data",
            "insert_after": "customer_name",
            "allow_on_submit": 0,
        },
    ]

    for cf in custom_fields:
        name = f"{cf['dt']}-{cf['fieldname']}"
        if not frappe.db.exists("Custom Field", name):
            doc = frappe.get_doc({
                "doctype": "Custom Field",
                **cf,
            })
            doc.insert(ignore_permissions=True)


def _ensure_docperms():
    perms = [
        {"parent": "Customer", "role": "EngOS Integration", "read": 1, "write": 1, "create": 1},
        {"parent": "Item", "role": "EngOS Integration", "read": 1, "write": 0, "create": 0},
        {"parent": "Sales Order", "role": "EngOS Integration", "read": 1, "write": 1, "create": 0},
    ]
    for p in perms:
        if not frappe.db.exists("Custom DocPerm", {"parent": p["parent"], "role": p["role"], "permlevel": 0}):
            try:
                frappe.get_doc({
                    "doctype": "Custom DocPerm",
                    "parent": p["parent"],
                    "parenttype": "DocType",
                    "parentfield": "permissions",
                    "role": p["role"],
                    "permlevel": 0,
                    "read": p["read"],
                    "write": p["write"],
                    "create": p["create"],
                }).insert(ignore_permissions=True)
            except Exception as e:
                frappe.logger("acs_erp").error(f"Failed to create Custom DocPerm for {p['parent']}: {e}")


def update_api_user():
    """Restricts engos-api user to EngOS Integration role."""
    if frappe.db.exists("User", "engos-api@acsengitech.com"):
        u = frappe.get_doc("User", "engos-api@acsengitech.com")
        u.roles = [r for r in u.roles if r.role in ("All", "EngOS Integration")]
        if not any(r.role == "EngOS Integration" for r in u.roles):
            u.append("roles", {"role": "EngOS Integration"})
        u.save(ignore_permissions=True)
        frappe.db.commit()
        return [r.role for r in u.roles]
    return []

