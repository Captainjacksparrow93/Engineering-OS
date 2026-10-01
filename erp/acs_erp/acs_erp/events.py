import frappe
from frappe import _


def validate_sales_order(doc, method=None):
    """Ensures custom_wo_number consists of digits only when set."""
    wo_num = doc.get("custom_wo_number")
    if wo_num:
        clean_wo = str(wo_num).strip()
        if not clean_wo.isdigit():
            frappe.throw(_("WO number must contain digits only."))
