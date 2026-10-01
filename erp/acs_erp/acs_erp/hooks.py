app_name = "acs_erp"
app_title = "ACS ERP"
app_publisher = "ACS Engitech"
app_description = "Engineering OS ERP integration, SSO and styling"
app_email = "admin@acsengitech.com"
app_license = "Proprietary"
app_version = "0.1.0"

# Includes in <head>
# ------------------

# include css in header of desk.html
app_include_css = "/assets/acs_erp/css/acs_theme.css"

# include css in header of web template
web_include_css = "/assets/acs_erp/css/acs_theme.css"

# Installation & Migrations
# -------------------------
after_install = "acs_erp.install.after_install"
after_migrate = "acs_erp.install.after_install"

# Document Events
# ---------------
doc_events = {
    "Sales Order": {
        "validate": "acs_erp.events.validate_sales_order",
    }
}

# Fixtures
# --------
fixtures = [
    {
        "doctype": "Custom Field",
        "filters": [
            [
                "name",
                "in",
                [
                    "Sales Order-custom_wo_number",
                    "Sales Order-custom_project_code",
                    "Sales Order-custom_project_link",
                    "Customer-custom_acs_reference",
                ],
            ]
        ],
    },
    {
        "doctype": "Role",
        "filters": [["name", "in", ["EngOS Integration"]]],
    },
    {
        "doctype": "Custom DocPerm",
        "filters": [["role", "in", ["EngOS Integration"]]],
    },
]
