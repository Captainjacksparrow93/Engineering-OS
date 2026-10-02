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

from acs_erp.install import _ensure_allowed_referrers


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


if __name__ == '__main__':
    unittest.main()
