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
