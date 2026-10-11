import json
import os
import sys
import unittest
from unittest.mock import MagicMock

mock_frappe = sys.modules.get('frappe') or MagicMock()
mock_frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn)
mock_frappe._ = lambda s: s
mock_installer = sys.modules.get('frappe.installer') or MagicMock()
mock_frappe.installer = mock_installer
sys.modules['frappe'] = mock_frappe
sys.modules['frappe.installer'] = mock_installer

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..')))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))

from acs_erp.install import _ensure_custom_fields
from acs_erp import hooks


class TestImportedField(unittest.TestCase):
    """Plan 015 step 1: imported orders are marked with a read-only check."""

    def test_creates_custom_imported_on_sales_order(self):
        mock_frappe.reset_mock()
        mock_frappe.db.exists.return_value = False
        _ensure_custom_fields()
        created = [c.args[0] for c in mock_frappe.get_doc.call_args_list]
        imported = [d for d in created if d.get('fieldname') == 'custom_imported']
        self.assertEqual(len(imported), 1)
        field = imported[0]
        self.assertEqual(field['dt'], 'Sales Order')
        self.assertEqual(field['fieldtype'], 'Check')
        self.assertEqual(field['read_only'], 1)
        self.assertEqual(field['label'], 'Imported from Engineering OS')

    def test_fixture_and_hooks_list_it(self):
        with open(os.path.join(HERE, '..', 'fixtures', 'custom_field.json')) as f:
            names = [d['name'] for d in json.load(f)]
        self.assertIn('Sales Order-custom_imported', names)
        hook_names = hooks.fixtures[0]['filters'][0][2]
        self.assertIn('Sales Order-custom_imported', hook_names)


if __name__ == '__main__':
    unittest.main()
