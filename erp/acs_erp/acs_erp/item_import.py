"""Plan 017: import the item master from the old system's Excel export.

Run by hand only (never from after_install / after_migrate):

    bench --site frontend execute acs_erp.item_import.run --kwargs "{'path': '/tmp/items.xlsx', 'apply': False}"

Dry run by default; apply=True writes and commits once. Re-runs update only the mapped
fields that differ and never delete anything.
"""
import re

PANEL_ITEMS = {"PLC", "SCADA", "HMI"}
SIEMENS_PREFIXES = ("6ES7", "6AV", "6EP", "6SL", "3RT", "3RV")
GROUP_COLUMNS = ("CatDesc", "Group", "GroupDesc")
# Columns the mapping reads. If a new export lacks one, stop and look (plan 017: don't guess).
REQUIRED_COLUMNS = ("ItemCode", "ItemDesc", "DetailDesc", "PartNo", "Active", "MakeDesc") + GROUP_COLUMNS
NAME_MAX = 140


def _text(value):
    """Trimmed text with runs of whitespace collapsed to one space; None for empty."""
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def _active(value):
    if value is None or value == "":
        return True
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "y")


def clean_row(header, row, row_number):
    """One spreadsheet row → the Item fields, or {"error": ...} / {"skip": ...} naming the row."""
    columns = {(_text(h) or ""): i for i, h in enumerate(header)}

    def cell(name):
        i = columns.get(name)
        return row[i] if i is not None and i < len(row) else None

    code = _text(cell("ItemCode"))
    if not code:
        return {"error": f"Row {row_number}: ItemCode is empty."}
    name = _text(cell("ItemDesc"))
    if not name:
        return {"error": f"Row {row_number}: ItemDesc is empty."}
    if code in PANEL_ITEMS:
        return {"skip": f"Row {row_number}: {code} is a panel item used by projects; not imported."}

    part_no = _text(cell("PartNo"))
    brand = _text(cell("MakeDesc"))
    if not brand and part_no and part_no.upper().startswith(SIEMENS_PREFIXES):
        brand = "Siemens"

    item_name = name[:NAME_MAX]
    return {
        "item_code": code,
        "item_name": item_name,
        "description": _text(cell("DetailDesc")) or item_name,
        "custom_maker_part_no": part_no,
        "brand": brand,
        "item_group_path": [g for g in (_text(cell(c)) for c in GROUP_COLUMNS) if g],
        "disabled": 0 if _active(cell("Active")) else 1,
        "stock_uom": "Nos",
        "is_stock_item": 1,
    }


def clean_rows(header, rows):
    """All data rows (spreadsheet row 2 onward) → (items, problems). A repeated ItemCode is reported once more."""
    items, problems, first_seen = [], [], {}
    for offset, row in enumerate(rows):
        row_number = offset + 2
        if not any(v not in (None, "") for v in row):
            continue
        result = clean_row(header, row, row_number)
        if "error" in result or "skip" in result:
            problems.append(result)
            continue
        code = result["item_code"]
        if code in first_seen:
            problems.append({"error": f"Row {row_number}: ItemCode {code} is repeated (first on row {first_seen[code]}); not imported."})
            continue
        first_seen[code] = row_number
        items.append(result)
    return items, problems
