import json
import os
import sys
import unittest

# Ensure acs_erp package is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from passcodec import decode_and_verify, encode_pass, PassError


class TestPassCodec(unittest.TestCase):
    def setUp(self):
        vector_path = os.path.join(os.path.dirname(__file__), 'pass_vector.json')
        with open(vector_path, 'r', encoding='utf-8') as f:
            self.vector = json.load(f)
        self.secret = self.vector['secret']
        self.token = self.vector['pass']
        self.payload = self.vector['payload']

    def test_shared_test_vector(self):
        # Time within [iat, exp], e.g. 1700000010
        decoded = decode_and_verify(self.token, self.secret, expected_act='login', now=1700000010)
        self.assertEqual(decoded['v'], 1)
        self.assertEqual(decoded['act'], 'login')
        self.assertEqual(decoded['email'], 'director@acsengitech.com')
        self.assertEqual(decoded['name'], 'Jane Director')
        self.assertEqual(decoded['nonce'], '0123456789abcdef0123456789abcdef')
        self.assertEqual(decoded['roles'], self.payload['roles'])

    def test_encode_and_verify_roundtrip(self):
        token = encode_pass(
            payload={
                'v': 1,
                'act': 'disable',
                'email': 'saleshead@acsengitech.com',
                'name': 'Sales Head',
                'roles': ['Sales Manager'],
                'iat': 1700000100,
                'exp': 1700000130,
                'nonce': 'fedcba9876543210fedcba9876543210',
            },
            secret=self.secret,
        )
        decoded = decode_and_verify(token, self.secret, expected_act='disable', now=1700000115)
        self.assertEqual(decoded['act'], 'disable')
        self.assertEqual(decoded['email'], 'saleshead@acsengitech.com')

    def test_bad_signature_rejected(self):
        parts = self.token.split('.')
        tampered_token = parts[0] + '.invalid_signature'
        with self.assertRaises(PassError):
            decode_and_verify(tampered_token, self.secret, expected_act='login', now=1700000010)

    def test_expired_token_rejected(self):
        # exp is 1700000030. Allowing 5s skew, 1700000036 is expired
        with self.assertRaises(PassError):
            decode_and_verify(self.token, self.secret, expected_act='login', now=1700000036)

    def test_future_clock_skew_beyond_limit_rejected(self):
        # iat is 1700000000. If now is 1699999990 (10s before iat), reject
        with self.assertRaises(PassError):
            decode_and_verify(self.token, self.secret, expected_act='login', now=1699999990)

    def test_wrong_version_rejected(self):
        payload = dict(self.payload)
        payload['v'] = 2
        token = encode_pass(payload, self.secret)
        with self.assertRaises(PassError):
            decode_and_verify(token, self.secret, expected_act='login', now=1700000010)

    def test_wrong_act_rejected(self):
        # Vector has act='login', but we request expected_act='disable'
        with self.assertRaises(PassError):
            decode_and_verify(self.token, self.secret, expected_act='disable', now=1700000010)

    def test_malformed_input_rejected(self):
        for bad in ['', 'nodot', 'a.b.c', 'bad_b64.bad_sig', '.']:
            with self.assertRaises(PassError):
                decode_and_verify(bad, self.secret, expected_act='login', now=1700000010)

    def test_forbidden_emails_rejected(self):
        for forbidden in ['administrator', 'Administrator', 'ADMINISTRATOR', 'guest', 'Guest', 'noatsign', 'two@@atsigns.com', '@nodomain.com', 'nouser@']:
            payload = dict(self.payload)
            payload['email'] = forbidden
            token = encode_pass(payload, self.secret)
            with self.assertRaises(PassError):
                decode_and_verify(token, self.secret, expected_act='login', now=1700000010)


if __name__ == '__main__':
    unittest.main()

