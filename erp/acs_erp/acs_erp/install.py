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

    # 4. Ensure custom fields exist
    _ensure_custom_fields()

    # 5. Hide Projects module and disable Project creation (F8)
    _hide_projects_module()

    # 6. Ensure Engineering OS origin is in allowed_referrers (F9)
    _ensure_allowed_referrers()

    # 7. Ensure API user has Sales User role (F10)
    update_api_user()

    frappe.db.commit()


def _ensure_allowed_referrers():
    """Ensures Engineering OS origin from site config (acs_erp_engos_origin) is in allowed_referrers."""
    try:
        from frappe.installer import update_site_config

        engos_origin = frappe.conf.get("acs_erp_engos_origin")
        if not engos_origin:
            return

        if isinstance(engos_origin, str):
            origins = [o.strip() for o in engos_origin.split(",") if o.strip()]
        elif isinstance(engos_origin, (list, tuple)):
            origins = [str(o).strip() for o in engos_origin if str(o).strip()]
        else:
            origins = []

        if not origins:
            return

        current_referrers = frappe.conf.get("allowed_referrers") or []
        if isinstance(current_referrers, str):
            current_referrers = [current_referrers.strip()]
        elif isinstance(current_referrers, (list, tuple)):
            current_referrers = list(current_referrers)
        else:
            current_referrers = []

        modified = False
        for origin in origins:
            if origin not in current_referrers:
                current_referrers.append(origin)
                modified = True

        if modified:
            update_site_config("allowed_referrers", current_referrers)
            frappe.logger("acs_erp").info(
                f"Updated allowed_referrers in site_config to include: {origins}"
            )
    except Exception as e:
        frappe.logger("acs_erp").error(f"Failed to update allowed_referrers: {e}")


def _hide_projects_module():
    """Hides Projects workspace, removes create perm on Project DocType, and hides project field on orders."""
    # Hide Projects workspace
    try:
        workspaces = frappe.get_all("Workspace", filters={"name": ["in", ["Projects", "Project"]], "is_hidden": 0})
        for ws in workspaces:
            frappe.db.set_value("Workspace", ws.name, "is_hidden", 1, update_modified=False)
    except Exception as e:
        frappe.logger("acs_erp").error(f"Failed to hide Projects workspace: {e}")

    # Remove create permission on Project DocType for all roles
    try:
        # Standard DocPerms
        frappe.db.sql("""
            UPDATE `tabDocPerm`
            SET `create` = 0
            WHERE `parent` = 'Project'
        """)
        # Custom DocPerms if any
        if frappe.db.exists("DocType", "Custom DocPerm"):
            frappe.db.sql("""
                UPDATE `tabCustom DocPerm`
                SET `create` = 0
                WHERE `parent` = 'Project'
            """)
    except Exception as e:
        frappe.logger("acs_erp").error(f"Failed to remove create permissions on Project: {e}")

    # Hide project link field on transaction doctypes
    target_doctypes = ["Sales Order", "Quotation", "Sales Invoice", "Purchase Order"]
    for dt in target_doctypes:
        try:
            if frappe.db.exists("DocType", dt):
                meta = frappe.get_meta(dt)
                if meta.has_field("project"):
                    # Use frappe.make_property_setter to idempotently set hidden=1
                    frappe.make_property_setter({
                        "doctype": dt,
                        "fieldname": "project",
                        "property": "hidden",
                        "value": "1",
                        "property_type": "Check",
                    })
        except Exception as e:
            frappe.logger("acs_erp").error(f"Failed to hide project field on {dt}: {e}")



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


def update_api_user():
    """Assigns Sales User role to engos-api user (F10)."""
    if frappe.db.exists("User", "engos-api@acsengitech.com"):
        u = frappe.get_doc("User", "engos-api@acsengitech.com")
        u.roles = [r for r in u.roles if r.role not in ("EngOS Integration",)]
        if not any(r.role == "Sales User" for r in u.roles):
            u.append("roles", {"role": "Sales User"})
        u.save(ignore_permissions=True)
        frappe.db.commit()
        return [r.role for r in u.roles]
    return []

