"""
Boot session hook for acs_erp (F13).
Cleans up remaining branding in bootinfo:
- Rebrands app titles and app logos in bootinfo.app_data
- Rebrands sysdefaults app_name and otp_issuer_name
- Suppresses deprecated third-party banners from workspace block contents
"""

import json
import frappe


def boot_session(bootinfo):
    """Extends bootinfo to ensure all client-rendered apps, workspaces and labels reflect Engineering OS."""
    try:
        # 1. Update app_data in bootinfo
        if "app_data" in bootinfo and isinstance(bootinfo["app_data"], list):
            for app in bootinfo["app_data"]:
                if app.get("app_name") == "erpnext":
                    app["app_title"] = "ERP"
                    app["app_logo_url"] = "/assets/acs_erp/images/acs-logo.svg"
                elif app.get("app_name") == "frappe":
                    app["app_title"] = "Engineering OS"
                    app["app_logo_url"] = "/assets/acs_erp/images/acs-logo.svg"
                elif app.get("app_name") == "acs_erp":
                    app["app_title"] = "Engineering OS · ERP"
                    app["app_logo_url"] = "/assets/acs_erp/images/acs-logo.svg"

        # 2. Update sysdefaults
        if "sysdefaults" in bootinfo and isinstance(bootinfo["sysdefaults"], dict):
            bootinfo["sysdefaults"]["app_name"] = "Engineering OS · ERP"
            bootinfo["sysdefaults"]["otp_issuer_name"] = "Engineering OS"

        # 3. Suppress deprecation banner headers from workspaces
        if "workspaces" in bootinfo and isinstance(bootinfo["workspaces"], dict):
            pages = bootinfo["workspaces"].get("pages") or []
            for w in pages:
                if hasattr(w, "content") and w.content:
                    try:
                        blocks = json.loads(w.content)
                        cleaned = [
                            b
                            for b in blocks
                            if not (
                                b.get("type") == "header"
                                and "deprecation" in b.get("data", {}).get("text", "").lower()
                            )
                        ]
                        if len(cleaned) != len(blocks):
                            w.content = json.dumps(cleaned)
                    except Exception:
                        pass
    except Exception as e:
        frappe.logger("acs_erp").error(f"boot_session hook error: {e}")
