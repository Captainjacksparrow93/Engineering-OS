import sys
import unittest
from unittest.mock import MagicMock

# Mock frappe module before importing install
mock_frappe = sys.modules.get('frappe') or MagicMock()
mock_frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn)
mock_frappe._ = lambda s: s
mock_installer = sys.modules.get('frappe.installer') or MagicMock()
mock_frappe.installer = mock_installer
sys.modules['frappe'] = mock_frappe
sys.modules['frappe.installer'] = mock_installer

import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from acs_erp.install import _ensure_allowed_referrers, _ensure_custom_fields
import json


class TestEnsureAllowedReferrers(unittest.TestCase):
    def setUp(self):
        mock_frappe.reset_mock()
        mock_installer.reset_mock()
        mock_frappe.conf = {}

    def test_noop_when_origin_not_set(self):
        mock_frappe.conf = {}
        _ensure_allowed_referrers()
        mock_installer.update_site_config.assert_not_called()

    def test_adds_origin_when_referrers_none(self):
        mock_frappe.conf = {
            'acs_erp_engos_origin': 'http://127.0.0.1:3001',
            'allowed_referrers': None,
        }
        _ensure_allowed_referrers()
        mock_installer.update_site_config.assert_called_once_with(
            'allowed_referrers', ['http://127.0.0.1:3001']
        )

    def test_preserves_existing_referrers(self):
        mock_frappe.conf = {
            'acs_erp_engos_origin': 'http://127.0.0.1:3001',
            'allowed_referrers': ['http://127.0.0.1:8080'],
        }
        _ensure_allowed_referrers()
        mock_installer.update_site_config.assert_called_once_with(
            'allowed_referrers', ['http://127.0.0.1:8080', 'http://127.0.0.1:3001']
        )

    def test_idempotent_when_already_present(self):
        mock_frappe.conf = {
            'acs_erp_engos_origin': 'http://127.0.0.1:3001',
            'allowed_referrers': ['http://127.0.0.1:3001'],
        }
        _ensure_allowed_referrers()
        mock_installer.update_site_config.assert_not_called()

    def test_comma_separated_origins(self):
        mock_frappe.conf = {
            'acs_erp_engos_origin': 'http://127.0.0.1:3001, http://localhost:3001',
            'allowed_referrers': ['http://127.0.0.1:3001'],
        }
        _ensure_allowed_referrers()
        mock_installer.update_site_config.assert_called_once_with(
            'allowed_referrers', ['http://127.0.0.1:3001', 'http://localhost:3001']
        )


class TestMakerPartNoField(unittest.TestCase):
    """Plan 017: items are searchable and filterable by the maker's part number."""

    def setUp(self):
        mock_frappe.reset_mock()
        mock_frappe.db.exists.return_value = False

    def test_creates_the_field_on_item(self):
        mock_frappe.get_meta.return_value.search_fields = 'item_name,description'
        _ensure_custom_fields()
        created = [c.args[0] for c in mock_frappe.get_doc.call_args_list]
        field = next(d for d in created if d.get('fieldname') == 'custom_maker_part_no')
        self.assertEqual((field['dt'], field['fieldtype'], field['label'], field['insert_after'], field['in_standard_filter']),
                         ('Item', 'Data', 'Maker part no.', 'item_name', 1))

    def test_adds_it_to_item_search_fields_once(self):
        mock_frappe.get_meta.return_value.search_fields = 'item_name,description'
        _ensure_custom_fields()
        mock_frappe.make_property_setter.assert_called_once_with({
            'doctype': 'Item',
            'doctype_or_field': 'DocType',
            'property': 'search_fields',
            'value': 'item_name,description,custom_maker_part_no',
            'property_type': 'Data',
        })
        mock_frappe.reset_mock()
        mock_frappe.get_meta.return_value.search_fields = 'item_name,description,custom_maker_part_no'
        _ensure_custom_fields()
        mock_frappe.make_property_setter.assert_not_called()

    def test_fixture_and_hooks_list_it(self):
        here = os.path.dirname(__file__)
        with open(os.path.join(here, '..', 'fixtures', 'custom_field.json')) as f:
            self.assertIn('Item-custom_maker_part_no', [d['name'] for d in json.load(f)])
        from acs_erp import hooks
        self.assertIn('Item-custom_maker_part_no', hooks.fixtures[0]['filters'][0][2])


if __name__ == '__main__':
    unittest.main()
