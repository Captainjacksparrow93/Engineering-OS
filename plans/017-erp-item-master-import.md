# 017 — ERP: import the item master (demo PLC parts)

**Status:** IN PROGRESS   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** partner's Claude (via `Captainjacksparrow93/Engineering-OS`, branch `erp`)

## Goal
The company sent its first item-master export from the old system: [`docs/erp/demo-items-2026-10-02.xlsx`](../docs/erp/demo-items-2026-10-02.xlsx). It has one sheet, 38 rows, all Siemens S7-200 SMART PLC parts (CPUs, I/O modules, one cable), all active. Load it into ERPNext as clean **Items**, with a repeatable import that will also take the full export when it arrives.

This is ERPNext-only. PM (Prisma, `src/`) is **not** touched: items have no link to projects, clients or tasks yet. BOM and stock come later.

Evidence (read from the file 2026-10-02):
- Columns: `ItemCode, ItemDesc, DetailDesc, IGroupCode, CategoryID, Excisable, Note, PartNo, Active, GroupDesc, CatDesc, MakeDesc, (blank), Catg, Group, Suggetion`.
- `ItemCode` looks like `ASPLC0000009`, unique, with gaps in the numbering (…045, then …047).
- `MakeDesc` is "Siemens" on 29 rows and blank on 9, but every `PartNo` starts with `6ES7`, which is Siemens.
- `ItemDesc` has trailing padding. `DetailDesc` on the last rows is padded with thousands of spaces.
- The five labels `GroupDesc` (SMART PLC), `Group` (PLC), `CatDesc` ("Electronics "), `Catg` (Siemens Automation) and `Suggetion` (S7200 PLC) all say the same thing.
- `Excisable` (Yes 27 / No 11) is the pre-GST excise flag. We don't have a GSTIN yet (CLAUDE.md), so it's dropped.
- There is no price, stock, UOM, HSN or supplier in the file.

## Mapping (decided)
| Excel | ERPNext Item | Rule |
|---|---|---|
| `ItemCode` | `item_code` (name) | trimmed; the key for re-runs |
| `ItemDesc` | `item_name` | trimmed, internal whitespace collapsed, max 140 chars |
| `DetailDesc` | `description` | trimmed, whitespace collapsed; falls back to `item_name` if empty |
| `PartNo` | **new** custom field `custom_maker_part_no` ("Maker part no.") | trimmed |
| `MakeDesc` | `brand` | trimmed; if blank and `PartNo` starts with `6ES7` / `6AV` / `6EP` / `6SL` / `3RT` / `3RV`, use "Siemens"; otherwise leave blank |
| `CatDesc` › `Group` › `GroupDesc` | `item_group` | a tree under "All Item Groups": e.g. Electronics › PLC › SMART PLC (created if missing, trimmed, title case kept as given) |
| `Active` | `disabled` | `disabled = not Active` |
| — | `stock_uom` | "Nos" |
| — | `is_stock_item` | 1 (bought parts that will be stocked) |
| `IGroupCode, CategoryID, Excisable, Note, Catg, Suggetion`, blank column | — | dropped |

## Affected code
- `erp/acs_erp/acs_erp/item_import.py` (**new**):
  - a pure `clean_row(header, row) -> dict | error` with no `frappe` import, unit-testable;
  - `run(path, apply=False)`, called with `bench --site frontend execute acs_erp.item_import.run --kwargs "{'path': '...', 'apply': False}"`.
- `erp/acs_erp/acs_erp/install.py`, `_ensure_custom_fields`: add `Item-custom_maker_part_no` (Data, after `item_name`, in standard filter + search fields).
- `erp/acs_erp/acs_erp/fixtures/custom_field.json` and the `fixtures` filter in `erp/acs_erp/acs_erp/hooks.py`: add the same field, matching the existing four.
- `erp/acs_erp/acs_erp/tests/test_item_import.py` (**new**).
- Blast radius (code-review-graph, 2026-10-02, graph built at `7d24997`):
  - `install.py` + `hooks.py`: 8 nodes changed, 120 impacted within 2 hops, 53 files, risk **high**. Key entities: `decode_and_verify`, `_get_secret`, `disable_user`, `login` and `tests/test_passcodec.py`. The radius is wide because `hooks.py` wires SSO and events. **Only add to the custom-field list and fixtures. Don't change any other hook.**
  - Callers of `_ensure_custom_fields`: `after_install` only (which also runs as `after_migrate`).
  - `item_import.py` is new, so nothing calls it.

## Constraints
- Commit locally on branch `erp` only. Never push to `main` (a push to `main` deploys). Never merge `erp` into `main`.
- **ERPNext-only.** No Prisma migration, nothing under `src/`, nothing in `entrypoint.sh`.
- Local ERPNext only (`C:\Users\Dhruv-Home\erpnext-local`, see `AGENTS.md` "ERP work"). Never touch the VPS. The production import is Claude's, in plan 016.
- **Dry run by default.** `apply=True` writes. Re-running must be idempotent: existing items are **updated** field by field (only the mapped fields) and never deleted. Items in ERPNext that aren't in the file stay untouched.
- The import runs by hand only, never from `after_install` / `after_migrate`.
- Don't touch the three panel items (`PLC`, `SCADA`, `HMI`) created by `after_install`. If the file contains one of those codes, skip it and report it.
- No Custom DocPerm (see the Frappe permissions gotcha in `AGENTS.md`).
- No new pip dependency: `openpyxl` already ships with Frappe.
- Every rebuild of the `acs-erpnext` image gets a new `-acsN` tag. Recreate the containers and run `bench --site frontend migrate`, and write the running tag in the notes.

## Tools & skills (implementer: follow these)
- **Setup:** `git checkout erp`. Point Token Savior at this project ("Project management") and update the code-review-graph. Load `ponytail` (full) and the skills below.
- **Look before you change:** use the graph for callers and blast radius, and Token Savior to read code by symbol rather than whole files. If the graph can't find something, use text search and say so in notes.
- **Check first (graph):**
  - callers of `_ensure_custom_fields` and `after_install`;
  - blast radius of `install.py` and `hooks.py` (expect the 53-file radius above; your diff must stay inside the custom-field list and fixtures).
- **Read (Token Savior):**
  - `_ensure_custom_fields` (pattern for the new field);
  - `after_install` (panel items, so you don't collide with them);
  - `tests/test_install.py` (how `frappe` is mocked).
- **sequential-thinking:** required for step 3 (update vs skip rules, and what happens when an item group or brand is missing in the middle of a run). Not needed elsewhere.
- **Skills:**
  - `ponytail` (full, always): one module, plain functions, no class hierarchy;
  - `tdd` (tests first, every step);
  - `diagnosing-bugs` when something fails;
  - `review-delta` (before DONE).
- **Tests:**
  - `python -m unittest discover -s erp/acs_erp`.
  - The JS suite as a regression check, even though `src/` doesn't change: `npm run typecheck && npm test && npm run build` and `npm run test:int`.
  - Paste every pass/fail count into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [x] **1. Tests first: `clean_row`** (`tests/test_item_import.py`, red before step 2). Fixtures come from the real file, copied into the test as literal rows (don't read the xlsx in unit tests). Cases:
  - a normal row (`ASPLC0000009`) maps to the table above exactly;
  - a blank `MakeDesc` with `PartNo` `6ES72881ST400AA1` → brand "Siemens";
  - a blank `MakeDesc` with an unknown part number → no brand;
  - a padded `ItemDesc` / `DetailDesc` → trimmed and collapsed; `item_name` cut to 140 chars;
  - an empty `DetailDesc` → `description` = `item_name`;
  - `Active` False → `disabled` 1;
  - group path `"Electronics "`, `"PLC"`, `"SMART PLC"` → `["Electronics", "PLC", "SMART PLC"]`;
  - a missing `ItemCode` or `ItemDesc` → an error naming the row number, not an exception;
  - item codes `PLC` / `SCADA` / `HMI` → a skip with a reason;
  - columns are found **by header name**, not position (shuffle the header in one test);
  - a duplicate `ItemCode` within one file → the second copy is reported, not imported.
- [x] **2. Implement `clean_row`** until step 1 is green.
- [ ] **3. `run(path, apply=False)`.** Tests first, with `frappe` mocked as in `test_install.py`:
  - reads the first sheet with `openpyxl` (`read_only=True, data_only=True`);
  - creates missing Item Groups parent-first (`is_group=1` for parents, leaf `is_group=0`) and missing Brands. In dry-run mode it only reports them;
  - inserts new Items; for existing ones it updates only the mapped fields that differ;
  - commits once at the end when `apply=True`; any exception rolls the whole run back;
  - **output:** a summary line (`created / updated / unchanged / skipped / errors`, plus new groups and brands) and one line per non-unchanged row with the reason. Print it, and return it as a dict for the tests.
  - Tests cover: dry run writes nothing; apply creates; second apply → 0 created, 0 updated; one changed field → 1 updated; an error row doesn't stop the other rows but is listed.
- [ ] **4. Custom field `Item-custom_maker_part_no`** in `_ensure_custom_fields`, `fixtures/custom_field.json` and the `hooks.py` fixtures filter. Extend `test_install.py` for it. Rebuild the image as the next `-acsN` tag, recreate the containers, run `bench --site frontend migrate`, and confirm the field shows on the Item form.
- [ ] **5. Run it on the local ERPNext** with the real file. Copy `docs/erp/demo-items-2026-10-02.xlsx` into the backend container (`docker cp`), then:
  - dry run → paste the summary (expect 38 to create, 3 new groups, 1 brand, 0 errors);
  - `apply=True` → paste the summary;
  - `apply=True` again → 0 created, 0 updated.
- [ ] **6. Check it in a real browser** (signed in through our SSO as a Director):
  - Item list filtered to group "SMART PLC" shows 38 items;
  - searching `6ES72881ST400AA1` in the Item list finds `ASPLC0000043`;
  - `ASPLC0000043`'s brand is Siemens and its description has no long padding;
  - the `PLC` / `SCADA` / `HMI` panel items are unchanged.
  Note what you saw.

## Acceptance criteria
- [ ] `python -m unittest discover -s erp/acs_erp` passes, and the JS full suite is unchanged and green.
- [ ] The 38 demo items are in local ERPNext with clean names, descriptions, brand, group tree and maker part number, searchable by part number.
- [ ] Dry run changes nothing; a second apply changes nothing; nothing is ever deleted.
- [ ] No change under `src/` or `prisma/`, and no new dependency.
- [ ] The running image tag is written in the notes.

## Out of scope / open (ask the user, don't guess)
- Prices, stock opening balances, warehouses, HSN codes, suppliers, BOMs. None of these are in the file.
- The full export: same script, same command. If its columns differ, stop and note them instead of changing the mapping.

## Implementation notes (implementer)
- **Environment / tools:** same cloud container as plans 014/015 (local ERPNext in `/var/tmp/erpnext-local`, image `acs7` at the start). code-review-graph, Token Savior and sequential-thinking are not available here; I read `_ensure_custom_fields`, `after_install` and `tests/test_install.py` directly and found callers by text search (`_ensure_custom_fields` ← `after_install` only, which `hooks.py` also runs as `after_migrate`). The host Python has no `openpyxl` (the bench has 3.1.5), so `run()` imports `frappe` and `openpyxl` inside the function and the unit tests never need either.
- **The file, read on 2026-10-02 with the bench's openpyxl:** sheet `Sheet2`, header + 38 rows, all `Active` True, `MakeDesc` Siemens 29 / blank 9 (ASPLC0000038–45 and 47, all `6ES7…`), one group path (`Electronics ` › `PLC` › `SMART PLC`), longest trimmed `ItemDesc` 59 chars. Matches the plan's evidence.
- **Steps 1–2 (`clean_row`):** tests written first (`erp/acs_erp/acs_erp/tests/test_item_import.py`, 11, literal rows ASPLC0000009 and ASPLC0000043 from the file incl. their real padding): red (module missing), then `erp/acs_erp/acs_erp/item_import.py`: `clean_row(header, row, row_number)` → the Item fields (`item_code`, `item_name` ≤ 140, `description` (falls back to the name), `custom_maker_part_no`, `brand` (Siemens by part-number prefix when blank), `item_group_path`, `disabled`, `stock_uom` Nos, `is_stock_item` 1), or `{"error": "Row N: …"}` / `{"skip": "Row N: …"}`. Columns found by header name. `clean_rows(header, rows)` numbers rows like the spreadsheet (first data row = 2), skips fully blank rows, and reports a repeated `ItemCode` as an error. Committed together (one commit for steps 1–2) so no commit carries red tests. One choice not in the plan: a **blank** `Active` counts as active (only an explicit false/No/0 disables); the file has no blanks.
  - **Test counts:** `python3 -m unittest discover -s erp/acs_erp` 36 OK; typecheck clean; `npm test` 14 files / 168 passed; `npm run test:int` 20 files / 113 passed; build clean.

## Review (Claude)
<verdict, follow-ups>
