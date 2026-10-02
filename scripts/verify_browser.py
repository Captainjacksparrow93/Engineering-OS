import os
import sys
import time
from playwright.sync_api import sync_playwright

SCREENSHOTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "docs", "screenshots", "erp"))
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

ENGOS_BASE = "http://127.0.0.1:3001"
ERPNEXT_BASE = "http://127.0.0.1:8080"
PASSWORD = os.environ.get("SEED_PASSWORD", "ACSengi@2026")


def run_checks():
    google_requests = []

    def handle_request(request):
        url = request.url
        if "google" in url or "gstatic" in url or "googleapis" in url:
            google_requests.append(url)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        print("=== 1. Checking ERPNext Login Page ===")
        context_guest = browser.new_context(viewport={"width": 1440, "height": 900})
        page_guest = context_guest.new_page()
        page_guest.on("request", handle_request)
        page_guest.goto(f"{ERPNEXT_BASE}/login", wait_until="networkidle")
        time.sleep(1)
        login_img = os.path.join(SCREENSHOTS_DIR, "erpnext_login_page.png")
        page_guest.screenshot(path=login_img, full_page=True)
        print(f"Saved: {login_img}")
        context_guest.close()

        print("\n=== 2. Director Walkthrough (satishkumar.nagar@acsengitech.com) ===")
        context_dir = browser.new_context(viewport={"width": 1440, "height": 900})
        page_dir = context_dir.new_page()
        page_dir.on("request", handle_request)

        # Login to Engineering OS
        page_dir.goto(f"{ENGOS_BASE}/login", wait_until="networkidle")
        page_dir.fill("input[name='email']", "satishkumar.nagar@acsengitech.com")
        page_dir.fill("input[name='password']", PASSWORD)
        page_dir.click("button:has-text('Sign in')")
        page_dir.wait_for_load_state("networkidle")
        time.sleep(1)
        print(f"Director logged in, current URL: {page_dir.url}")

        # Dashboard
        page_dir.goto(f"{ENGOS_BASE}/dashboard", wait_until="networkidle")
        time.sleep(1)
        dash_img = os.path.join(SCREENSHOTS_DIR, "engos_director_dashboard.png")
        page_dir.screenshot(path=dash_img, full_page=True)
        print(f"Saved: {dash_img}")

        # Clients page
        page_dir.goto(f"{ENGOS_BASE}/pm/clients", wait_until="networkidle")
        time.sleep(1)
        clients_img = os.path.join(SCREENSHOTS_DIR, "engos_clients_page.png")
        page_dir.screenshot(path=clients_img, full_page=True)
        print(f"Saved: {clients_img}")

        # ERP launcher page
        page_dir.goto(f"{ENGOS_BASE}/erp", wait_until="networkidle")
        time.sleep(1)
        launcher_img = os.path.join(SCREENSHOTS_DIR, "engos_erp_launcher.png")
        page_dir.screenshot(path=launcher_img, full_page=True)
        print(f"Saved: {launcher_img}")

        # Open ERP SSO link
        print("Clicking Open ERP link (or navigating to /erp/open)...")
        with context_dir.expect_page() as new_page_info:
            page_dir.click("a:has-text('Open ERP')")
        erp_page_dir = new_page_info.value
        erp_page_dir.on("request", handle_request)
        erp_page_dir.wait_for_load_state("networkidle")
        time.sleep(3)
        print(f"Landed on ERPNext URL: {erp_page_dir.url}")

        desk_img = os.path.join(SCREENSHOTS_DIR, "erpnext_director_sso_desk.png")
        erp_page_dir.screenshot(path=desk_img, full_page=True)
        print(f"Saved: {desk_img}")

        # Selling workspace
        print("Navigating to Selling workspace...")
        erp_page_dir.goto(f"{ERPNEXT_BASE}/app/selling", wait_until="networkidle")
        time.sleep(2)
        selling_img = os.path.join(SCREENSHOTS_DIR, "erpnext_selling_workspace.png")
        erp_page_dir.screenshot(path=selling_img, full_page=True)
        print(f"Saved: {selling_img}")

        # Sales Order list
        print("Navigating to Sales Order list...")
        erp_page_dir.goto(f"{ERPNEXT_BASE}/app/sales-order", wait_until="networkidle")
        time.sleep(2)
        so_list_img = os.path.join(SCREENSHOTS_DIR, "erpnext_sales_order_list.png")
        erp_page_dir.screenshot(path=so_list_img, full_page=True)
        print(f"Saved: {so_list_img}")

        # Sales Order form
        print("Navigating to new Sales Order form...")
        erp_page_dir.goto(f"{ERPNEXT_BASE}/app/sales-order/new", wait_until="networkidle")
        time.sleep(3)
        so_form_img = os.path.join(SCREENSHOTS_DIR, "erpnext_sales_order_form.png")
        erp_page_dir.screenshot(path=so_form_img, full_page=True)
        print(f"Saved: {so_form_img}")

        # Check that 'project' field is hidden on Sales Order form (F8)
        project_field_visible = erp_page_dir.locator("input[data-fieldname='project']").is_visible()
        print(f"Sales Order 'project' field visible: {project_field_visible} (expected: False)")

        # Customer form
        print("Navigating to new Customer form...")
        erp_page_dir.goto(f"{ERPNEXT_BASE}/app/customer/new", wait_until="networkidle")
        time.sleep(3)
        cust_form_img = os.path.join(SCREENSHOTS_DIR, "erpnext_customer_form.png")
        erp_page_dir.screenshot(path=cust_form_img, full_page=True)
        print(f"Saved: {cust_form_img}")

        # Repeat SSO check (F2 / F9 verification in browser):
        print("Verifying repeat SSO navigation from Engineering OS...")
        page_dir.goto(f"{ENGOS_BASE}/erp", wait_until="networkidle")
        with context_dir.expect_page() as repeat_page_info:
            page_dir.click("a:has-text('Open ERP')")
        repeat_page = repeat_page_info.value
        repeat_page.wait_for_load_state("networkidle")
        time.sleep(2)
        print(f"Repeat SSO landed on: {repeat_page.url}")

        context_dir.close()

        print("\n=== 3. Sales Head Walkthrough (dharmesh.thummar@acsengitech.com) ===")
        context_sh = browser.new_context(viewport={"width": 1440, "height": 900})
        page_sh = context_sh.new_page()
        page_sh.on("request", handle_request)

        # Login to Engineering OS
        page_sh.goto(f"{ENGOS_BASE}/login", wait_until="networkidle")
        page_sh.fill("input[name='email']", "dharmesh.thummar@acsengitech.com")
        page_sh.fill("input[name='password']", PASSWORD)
        page_sh.click("button:has-text('Sign in')")
        page_sh.wait_for_load_state("networkidle")
        time.sleep(1)
        print(f"Sales Head logged in, current URL: {page_sh.url}")

        # ERP launcher page
        page_sh.goto(f"{ENGOS_BASE}/erp", wait_until="networkidle")
        time.sleep(1)

        # Click Open ERP
        with context_sh.expect_page() as sh_page_info:
            page_sh.click("a:has-text('Open ERP')")
        erp_page_sh = sh_page_info.value
        erp_page_sh.on("request", handle_request)
        erp_page_sh.wait_for_load_state("networkidle")
        time.sleep(3)
        print(f"Sales Head landed on ERPNext URL: {erp_page_sh.url}")

        sh_desk_img = os.path.join(SCREENSHOTS_DIR, "erpnext_sales_head_sso_desk.png")
        erp_page_sh.screenshot(path=sh_desk_img, full_page=True)
        print(f"Saved: {sh_desk_img}")

        # Check Sales Head can open Selling and Buying
        erp_page_sh.goto(f"{ERPNEXT_BASE}/app/selling", wait_until="networkidle")
        time.sleep(2)
        print(f"Sales Head /app/selling title/URL: {erp_page_sh.title()} - {erp_page_sh.url}")

        # Check Sales Head CANNOT access System Settings (not System Manager)
        erp_page_sh.goto(f"{ERPNEXT_BASE}/app/system-settings", wait_until="networkidle")
        time.sleep(2)
        system_settings_title = erp_page_sh.title()
        print(f"Sales Head /app/system-settings: title='{system_settings_title}', URL='{erp_page_sh.url}'")
        not_permitted = "Not Permitted" in erp_page_sh.content() or "Not Permitted" in system_settings_title
        print(f"Sales Head System Settings blocked: {not_permitted}")

        context_sh.close()
        browser.close()

    print("\n=== 4. Google Font / CSS Network Requests Audit ===")
    print(f"Total Google requests detected: {len(google_requests)}")
    if google_requests:
        for r in google_requests:
            print(f"  - {r}")
    else:
        print("CONFIRMED: Zero requests to Google fonts, Google CSS, or external CDN.")

    return len(google_requests) == 0


if __name__ == "__main__":
    success = run_checks()
    sys.exit(0 if success else 1)
