"""Click-token attribution helpers."""

from __future__ import annotations

import base64
import datetime as dt
import hmac
import json
from hashlib import sha256
from typing import Any, Dict, Tuple


def _normalize_iso8601(value: str) -> str:
    if value.endswith("Z"):
        return value[:-1] + "+00:00"
    if "+" not in value and "-" in value[10:]:
        # Already includes timezone offset.
        return value
    if len(value) == 19:
        # Assume UTC if no offset provided.
        return value + "+00:00"
    return value


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def generate_click_token(payload: Dict[str, Any], secret: str, *, version: int = 1) -> str:
    """Return a base64url-encoded click token containing an HMAC signature."""

    required_fields = {"click_id", "campaign_id", "channel", "occurred_at"}
    missing = sorted(required_fields - payload.keys())
    if missing:
        raise ValueError(f"missing required fields: {', '.join(missing)}")

    token = dict(payload)
    token["version"] = int(token.get("version", version))
    normalized_timestamp = _normalize_iso8601(str(token["occurred_at"]))
    token["occurred_at"] = normalized_timestamp

    signing_payload = json.dumps(
        {k: token[k] for k in sorted(token.keys()) if k != "signature"},
        separators=(",", ":"),
    ).encode("utf-8")

    signature = hmac.new(secret.encode("utf-8"), signing_payload, sha256).digest()
    token["signature"] = _base64url_encode(signature)

    token_bytes = json.dumps(token, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return _base64url_encode(token_bytes)


def verify_click_token(token: str, secret: str) -> Tuple[bool, Dict[str, Any], str | None]:
    """Verify HMAC signature and return payload."""

    try:
        decoded = json.loads(_base64url_decode(token))
    except (json.JSONDecodeError, ValueError) as exc:
        return False, {}, f"decode_error:{exc}"

    if "signature" not in decoded:
        return False, decoded, "missing_signature"

    signature = decoded.pop("signature")
    signing_payload = json.dumps(
        {k: decoded[k] for k in sorted(decoded.keys())},
        separators=(",", ":"),
    ).encode("utf-8")
    expected_sig = _base64url_encode(hmac.new(secret.encode("utf-8"), signing_payload, sha256).digest())

    if not hmac.compare_digest(signature, expected_sig):
        return False, decoded, "invalid_signature"

    try:
        decoded["occurred_at"] = dt.datetime.fromisoformat(_normalize_iso8601(decoded["occurred_at"]))
    except (KeyError, ValueError) as exc:
        return False, decoded, f"invalid_timestamp:{exc}"

    return True, decoded, None


CHANNEL_MAP = {
    "paid_search": "paid_search",
    "paid_social": "paid_social",
    "organic_social": "organic_social",
    "affiliate": "affiliate",
    "influencer": "influencer",
    "email": "email",
}


def classify_channel_group(channel: str) -> str:
    """Return canonical channel group based on channel code."""

    if not channel:
        return "direct"
    channel = channel.lower()
    for prefix, group in CHANNEL_MAP.items():
        if channel.startswith(prefix):
            return group
    if channel.startswith("organic"):
        return "organic_social"
    if channel.startswith("direct"):
        return "direct"
    return "other"


def can_attribute_conversion(
    token_payload: Dict[str, Any],
    conversion_timestamp: dt.datetime,
    *,
    window: dt.timedelta = dt.timedelta(days=7),
    require_matching_anon: bool = False,
    anon_hash: str | None = None,
) -> bool:
    """Return True if conversion falls within attribution window and passes integrity checks."""

    occurred_at = token_payload.get("occurred_at")
    if not isinstance(occurred_at, dt.datetime):
        raise ValueError("token payload must have occurred_at as datetime")

    delta = conversion_timestamp - occurred_at
    if delta < dt.timedelta(0) or delta > window:
        return False

    if require_matching_anon and anon_hash is not None:
        token_anon = token_payload.get("anon_id")
        if not token_anon or token_anon != anon_hash:
            return False

    return True
