"""Plan 017: item master import. No frappe and no openpyxl needed for these tests."""
import os
import sys
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..')))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))

from acs_erp.item_import import clean_row, clean_rows  # noqa: E402

HEADER = (
    'ItemCode', 'ItemDesc', 'DetailDesc', 'IGroupCode', 'CategoryID', 'Excisable', 'Note', 'PartNo',
    'Active', 'GroupDesc', 'CatDesc', 'MakeDesc', None, 'Catg', 'Group', 'Suggetion',
)

# Literal rows from docs/erp/demo-items-2026-10-02.xlsx (the padding is as in the file).
ROW_009 = (
    'ASPLC0000009', 'S7200 smart CPU CR40 AC/DC/relay 24DI/16DO' + ' ' * 13,
    'S7200 smart CPU CR40 , Relay output , 220 V AC , 24 inputs / 16 outputs',
    'SPLC', 3, 'Yes', None, '6ES72881CR400AA0', True, 'SMART PLC', 'Electronics ', 'Siemens', None,
    'Siemens Automation ', 'PLC', 'S7200 PLC',
)
ROW_043 = (
    'ASPLC0000043', 'S7200 smart CPU ST40 DC/DC/DC relay 24DI/16DO ',
    'SIMATIC S7-200 SMART, CPU ST40, CPU, DC/DC/DC, onboard I/O: 24 DI 24 V DC; 16 DO 24 V DC; power supply: '
    'DC 20.4 - 28.8 V DC, program/data memory 40 KB web server support' + ' ' * 3831,
    'SPLC', 3, 'No', '', '6ES72881ST400AA1', True, 'SMART PLC', 'Electronics ', '', None,
    'Siemens Automation ', 'PLC', 'S7200 PLC',
)


def with_values(row, **changes):
    values = list(row)
    for name, value in changes.items():
        values[HEADER.index(name)] = value
    return tuple(values)


class TestCleanRow(unittest.TestCase):
    def test_normal_row_maps_exactly(self):
        self.assertEqual(clean_row(HEADER, ROW_009, 2), {
            'item_code': 'ASPLC0000009',
            'item_name': 'S7200 smart CPU CR40 AC/DC/relay 24DI/16DO',
            'description': 'S7200 smart CPU CR40 , Relay output , 220 V AC , 24 inputs / 16 outputs',
            'custom_maker_part_no': '6ES72881CR400AA0',
            'brand': 'Siemens',
            'item_group_path': ['Electronics', 'PLC', 'SMART PLC'],
            'disabled': 0,
            'stock_uom': 'Nos',
            'is_stock_item': 1,
        })

    def test_blank_make_with_siemens_part_number_is_siemens(self):
        self.assertEqual(clean_row(HEADER, ROW_043, 36)['brand'], 'Siemens')

    def test_blank_make_with_unknown_part_number_has_no_brand(self):
        item = clean_row(HEADER, with_values(ROW_043, PartNo='ABB-1SVR'), 3)
        self.assertIsNone(item['brand'])

    def test_padding_is_trimmed_and_collapsed_and_name_is_cut_to_140(self):
        item = clean_row(HEADER, ROW_043, 36)
        self.assertFalse(item['description'].endswith(' '))
        self.assertNotIn('  ', item['description'])
        long_name = 'CPU   ' + 'x' * 200
        self.assertEqual(clean_row(HEADER, with_values(ROW_009, ItemDesc=long_name), 2)['item_name'], ('CPU ' + 'x' * 200)[:140])

    def test_empty_detail_falls_back_to_item_name(self):
        item = clean_row(HEADER, with_values(ROW_009, DetailDesc='   '), 2)
        self.assertEqual(item['description'], 'S7200 smart CPU CR40 AC/DC/relay 24DI/16DO')

    def test_inactive_row_is_disabled(self):
        self.assertEqual(clean_row(HEADER, with_values(ROW_009, Active=False), 2)['disabled'], 1)

    def test_group_path_is_trimmed(self):
        self.assertEqual(clean_row(HEADER, ROW_009, 2)['item_group_path'], ['Electronics', 'PLC', 'SMART PLC'])

    def test_missing_code_or_name_is_an_error_naming_the_row(self):
        self.assertEqual(clean_row(HEADER, with_values(ROW_009, ItemCode='  '), 7), {'error': 'Row 7: ItemCode is empty.'})
        self.assertEqual(clean_row(HEADER, with_values(ROW_009, ItemDesc=None), 8), {'error': 'Row 8: ItemDesc is empty.'})

    def test_panel_item_codes_are_skipped(self):
        for code in ('PLC', 'SCADA', 'HMI'):
            result = clean_row(HEADER, with_values(ROW_009, ItemCode=code), 4)
            self.assertEqual(result, {'skip': f'Row 4: {code} is a panel item used by projects; not imported.'})

    def test_columns_are_found_by_header_name(self):
        order = list(range(len(HEADER)))
        order.reverse()
        shuffled_header = tuple(HEADER[i] for i in order)
        shuffled_row = tuple(ROW_009[i] for i in order)
        self.assertEqual(clean_row(shuffled_header, shuffled_row, 2), clean_row(HEADER, ROW_009, 2))

    def test_duplicate_item_code_in_one_file_is_reported_not_imported(self):
        items, problems = clean_rows(HEADER, [ROW_009, ROW_043, with_values(ROW_009, ItemDesc='Copy')])
        self.assertEqual([i['item_code'] for i in items], ['ASPLC0000009', 'ASPLC0000043'])
        self.assertEqual(problems, [{'error': 'Row 4: ItemCode ASPLC0000009 is repeated (first on row 2); not imported.'}])


if __name__ == '__main__':
    unittest.main()


# ---- run(): frappe and openpyxl faked in memory -------------------------------------------
import types  # noqa: E402
from unittest.mock import patch  # noqa: E402

KEY = {'Item': 'item_code', 'Item Group': 'item_group_name', 'Brand': 'brand'}


class FakeFrappe(types.ModuleType):
    """Just the frappe calls run() makes. Writes land in `store` immediately; commit/rollback are counted."""

    def __init__(self):
        super().__init__('frappe')
        self.store = {'Item': {}, 'Item Group': {'All Item Groups': {'item_group_name': 'All Item Groups', 'is_group': 1}}, 'Brand': {}}
        self.writes, self.commits, self.rollbacks, self.fail_on = [], 0, 0, None
        fake = self

        class Doc(dict):
            def get(self, key, default=None):
                return dict.get(self, key, default)

            def insert(self):
                if fake.fail_on and fake.fail_on == self.get(KEY[self['doctype']]):
                    raise RuntimeError('database went away')
                fake.writes.append(('insert', self['doctype'], self.get(KEY[self['doctype']])))
                fake.store[self['doctype']][self[KEY[self['doctype']]]] = dict(self)
                return self

            def save(self):
                fake.writes.append(('save', self['doctype'], self.get(KEY[self['doctype']])))
                fake.store[self['doctype']][self[KEY[self['doctype']]]] = dict(self)
                return self

        self.Doc = Doc
        self.db = types.SimpleNamespace(
            exists=lambda doctype, name: name in self.store[doctype],
            commit=lambda: setattr(self, 'commits', self.commits + 1),
            rollback=lambda: setattr(self, 'rollbacks', self.rollbacks + 1),
        )

    def get_doc(self, arg, name=None):
        if isinstance(arg, dict):
            return self.Doc(arg)
        return self.Doc({'doctype': arg, **self.store[arg][name]})


def fake_openpyxl(rows):
    sheet = types.SimpleNamespace(iter_rows=lambda values_only=True: iter(rows))
    module = types.ModuleType('openpyxl')
    module.load_workbook = lambda path, read_only=True, data_only=True: types.SimpleNamespace(worksheets=[sheet])
    return module


class TestRun(unittest.TestCase):
    def setUp(self):
        self.frappe = FakeFrappe()

    def run_import(self, rows, apply):
        from acs_erp.item_import import run
        with patch.dict(sys.modules, {'frappe': self.frappe, 'openpyxl': fake_openpyxl([HEADER, *rows])}):
            with patch('builtins.print'):
                return run('/tmp/items.xlsx', apply=apply)

    def test_dry_run_writes_nothing_and_reports(self):
        report = self.run_import([ROW_009, ROW_043], apply=False)
        self.assertEqual(self.frappe.writes, [])
        self.assertEqual(self.frappe.commits, 0)
        self.assertEqual((report['created'], report['updated'], report['unchanged'], report['skipped'], report['errors']), (2, 0, 0, 0, 0))
        self.assertEqual(report['new_groups'], ['Electronics', 'PLC', 'SMART PLC'])
        self.assertEqual(report['new_brands'], ['Siemens'])

    def test_apply_creates_groups_parent_first_brand_and_items_then_commits_once(self):
        report = self.run_import([ROW_009, ROW_043], apply=True)
        self.assertEqual(report['created'], 2)
        groups = self.frappe.store['Item Group']
        self.assertEqual(groups['Electronics']['parent_item_group'], 'All Item Groups')
        self.assertEqual(groups['PLC']['parent_item_group'], 'Electronics')
        self.assertEqual(groups['SMART PLC']['parent_item_group'], 'PLC')
        self.assertEqual([groups[g]['is_group'] for g in ('Electronics', 'PLC', 'SMART PLC')], [1, 1, 0])
        self.assertIn('Siemens', self.frappe.store['Brand'])
        item = self.frappe.store['Item']['ASPLC0000043']
        self.assertEqual((item['item_group'], item['brand'], item['custom_maker_part_no'], item['stock_uom'], item['is_stock_item']),
                         ('SMART PLC', 'Siemens', '6ES72881ST400AA1', 'Nos', 1))
        inserts = [w for w in self.frappe.writes if w[0] == 'insert']
        self.assertEqual([w[2] for w in inserts[:3]], ['Electronics', 'PLC', 'SMART PLC'])
        self.assertEqual(self.frappe.commits, 1)

    def test_second_apply_changes_nothing(self):
        self.run_import([ROW_009, ROW_043], apply=True)
        self.frappe.writes.clear()
        report = self.run_import([ROW_009, ROW_043], apply=True)
        self.assertEqual((report['created'], report['updated'], report['unchanged']), (0, 0, 2))
        self.assertEqual(self.frappe.writes, [])

    def test_one_changed_field_updates_only_that_item(self):
        self.run_import([ROW_009, ROW_043], apply=True)
        self.frappe.store['Item']['ASPLC0000009']['custom_maker_part_no'] = 'OLD'
        self.frappe.store['Item']['ASPLC0000009']['stock_uom'] = 'Box'  # not a mapped update field: left alone
        report = self.run_import([ROW_009, ROW_043], apply=True)
        self.assertEqual((report['created'], report['updated'], report['unchanged']), (0, 1, 1))
        self.assertEqual(self.frappe.store['Item']['ASPLC0000009']['custom_maker_part_no'], '6ES72881CR400AA0')
        self.assertEqual(self.frappe.store['Item']['ASPLC0000009']['stock_uom'], 'Box')
        self.assertTrue(any('ASPLC0000009' in line and 'custom_maker_part_no' in line for line in report['lines']))

    def test_an_error_row_is_listed_and_the_others_still_import(self):
        report = self.run_import([ROW_009, with_values(ROW_043, ItemCode=''), with_values(ROW_009, ItemCode='PLC')], apply=True)
        self.assertEqual((report['created'], report['skipped'], report['errors']), (1, 1, 1))
        self.assertIn('Row 3: ItemCode is empty.', report['lines'])
        self.assertNotIn('PLC', self.frappe.store['Item'])

    def test_a_failure_while_writing_rolls_everything_back(self):
        self.frappe.fail_on = 'ASPLC0000043'
        with self.assertRaises(RuntimeError):
            self.run_import([ROW_009, ROW_043], apply=True)
        self.assertEqual((self.frappe.commits, self.frappe.rollbacks), (0, 1))

    def test_missing_column_stops_before_any_write(self):
        header = tuple(h for h in HEADER if h != 'PartNo')
        from acs_erp.item_import import run
        with patch.dict(sys.modules, {'frappe': self.frappe, 'openpyxl': fake_openpyxl([header, ROW_009[:7] + ROW_009[8:]])}):
            with patch('builtins.print'):
                report = run('/tmp/items.xlsx', apply=True)
        self.assertEqual(self.frappe.writes, [])
        self.assertEqual(report['errors'], 1)
        self.assertIn('PartNo', report['lines'][0])
