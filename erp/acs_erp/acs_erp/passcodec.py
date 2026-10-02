"""Frappe-free SSO pass encoder and decoder.

Pass format:
pass = base64url(payloadJSON) + "." + base64url(HMAC_SHA256(secret, base64url(payloadJSON)))
"""

import base64
import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional


class PassError(Exception):
    """Base exception for SSO pass verification failures."""
    pass


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')


def _b64url_decode(s: str) -> bytes:
    pad = len(s) % 4
    if pad:
        s += '=' * (4 - pad)
    return base64.urlsafe_b64decode(s.encode('ascii'))


def encode_pass(payload: Dict[str, Any], secret: str) -> str:
    """Encodes a payload dict and signs it with the secret using HMAC-SHA256."""
    payload_json = json.dumps(payload, separators=(',', ':'), ensure_ascii=False)
    b64_payload = _b64url_encode(payload_json.encode('utf-8'))
    sig = _compute_signature(b64_payload, secret)
    return f"{b64_payload}.{sig}"


def _compute_signature(b64_payload: str, secret: str) -> str:
    digest = hmac.new(
        secret.encode('utf-8'),
        b64_payload.encode('utf-8'),
        hashlib.sha256,
    ).digest()
    return _b64url_encode(digest)


def decode_and_verify(
    token: str,
    secret: str,
    expected_act: Optional[str] = None,
    now: Optional[int] = None,
    skew_seconds: int = 5,
) -> Dict[str, Any]:
    """Decodes and verifies an SSO pass constant-time.

    Raises PassError on any validation failure.
    """
    if not token or not isinstance(token, str):
        raise PassError("Token must be a non-empty string.")

    parts = token.split('.')
    if len(parts) != 2:
        raise PassError("Token must contain exactly one dot separator.")

    b64_payload, b64_sig = parts
    if not b64_payload or not b64_sig:
        raise PassError("Token has missing payload or signature.")

    expected_sig = _compute_signature(b64_payload, secret)
    if not hmac.compare_digest(b64_sig, expected_sig):
        raise PassError("Signature mismatch.")

    try:
        raw_json = _b64url_decode(b64_payload).decode('utf-8')
        payload = json.loads(raw_json)
    except Exception as e:
        raise PassError(f"Malformed payload JSON: {e}") from e

    if not isinstance(payload, dict):
        raise PassError("Payload must be a JSON object.")

    if payload.get("v") != 1:
        raise PassError(f"Unsupported pass version: {payload.get('v')}")

    act = payload.get("act")
    if expected_act is not None and act != expected_act:
        raise PassError(f"Unexpected act: got '{act}', expected '{expected_act}'.")

    for required in ("email", "nonce", "iat", "exp"):
        if required not in payload:
            raise PassError(f"Missing required field in payload: {required}")

    email = payload.get("email")
    if not isinstance(email, str) or not email.strip():
        raise PassError("Invalid or missing email.")

    clean_email = email.strip().lower()
    if clean_email in ("administrator", "guest"):
        raise PassError(f"Email '{clean_email}' is not allowed for SSO.")

    at_parts = clean_email.split('@')
    if len(at_parts) != 2 or not at_parts[0] or not at_parts[1]:
        raise PassError(f"Email '{clean_email}' is not a valid email address.")

    current_time = now if now is not None else int(time.time())
    exp = payload.get("exp", 0)
    iat = payload.get("iat", 0)

    if exp + skew_seconds < current_time:
        raise PassError("Pass expired.")

    if iat - skew_seconds > current_time:
        raise PassError("Pass issued in the future.")

    return payload

