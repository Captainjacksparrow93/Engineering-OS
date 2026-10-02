import frappe


def execute():
    """Drops EngOS Integration role and Custom DocPerms, reassigns engos-api user to Sales User."""
    # 1. Delete Custom DocPerm rows for EngOS Integration and reset to standard perms
    if frappe.db.exists("DocType", "Custom DocPerm"):
        custom_perms = frappe.get_all(
            "Custom DocPerm",
            filters={"role": "EngOS Integration"},
            pluck="name",
        )
        for perm_name in custom_perms:
            try:
                frappe.delete_doc("Custom DocPerm", perm_name, ignore_permissions=True, force=True)
            except Exception as e:
                frappe.logger("acs_erp").error(f"Failed deleting Custom DocPerm {perm_name}: {e}")

        # Reset custom docperms for the core doctypes so standard permissions apply
        from frappe.permissions import reset_perms
        for dt in ["Sales Order", "Customer", "Item"]:
            reset_perms(dt)

    # 2. Reassign engos-api user to Sales User
    if frappe.db.exists("User", "engos-api@acsengitech.com"):
        user_doc = frappe.get_doc("User", "engos-api@acsengitech.com")
        user_doc.roles = [r for r in user_doc.roles if r.role != "EngOS Integration"]
        if not any(r.role == "Sales User" for r in user_doc.roles):
            user_doc.append("roles", {"role": "Sales User"})
        user_doc.save(ignore_permissions=True)

    # 3. Delete EngOS Integration Role if present
    if frappe.db.exists("Role", "EngOS Integration"):
        try:
            frappe.delete_doc("Role", "EngOS Integration", ignore_permissions=True, force=True)
        except Exception as e:
            frappe.logger("acs_erp").error(f"Failed deleting Role EngOS Integration: {e}")

    # 4. Clear cache on affected DocTypes so standard DocPerms take effect immediately
    for dt in ["Sales Order", "Customer", "Item"]:
        frappe.clear_cache(doctype=dt)
    frappe.clear_cache(user="engos-api@acsengitech.com")
    frappe.db.commit()
