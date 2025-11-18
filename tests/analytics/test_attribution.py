import datetime as dt

import unittest

from tools.analytics.attribution import (
    can_attribute_conversion,
    classify_channel_group,
    generate_click_token,
    verify_click_token,
)


class TestAttribution(unittest.TestCase):
    def test_generate_and_verify_click_token_round_trip(self):
        payload = {
            "click_id": "clk_123",
            "campaign_id": "cmp_456",
            "channel": "paid_search.google",
            "placement": "adgroup-1",
            "occurred_at": "2025-11-18T10:00:00Z",
            "anon_id": "anon_hash",
        }
        secret = "super-secret"

        token = generate_click_token(payload, secret)
        valid, decoded, reason = verify_click_token(token, secret)

        self.assertTrue(valid)
        self.assertIsNone(reason)
        self.assertEqual(decoded["click_id"], "clk_123")
        self.assertEqual(decoded["channel"], "paid_search.google")
        self.assertEqual(decoded["occurred_at"], dt.datetime(2025, 11, 18, 10, 0, tzinfo=dt.timezone.utc))

    def test_verify_click_token_detects_bad_signature(self):
        secret = "super-secret"
        token = generate_click_token(
            {
                "click_id": "clk",
                "campaign_id": "cmp",
                "channel": "affiliate.network",
                "occurred_at": "2025-11-18T16:00:00Z",
            },
            secret,
        )
        tampered = token[:-2] + ("A" if token[-1] != "A" else "B")
        valid, decoded, reason = verify_click_token(tampered, secret)
        self.assertFalse(valid)
        self.assertTrue(reason.startswith("decode_error") or reason == "invalid_signature")

    def test_channel_group_classification(self):
        self.assertEqual(classify_channel_group("paid_social.meta"), "paid_social")
        self.assertEqual(classify_channel_group("organic_blog"), "organic_social")
        self.assertEqual(classify_channel_group("email.weekly"), "email")
        self.assertEqual(classify_channel_group("unknown"), "other")
        self.assertEqual(classify_channel_group(""), "direct")

    def test_can_attribute_conversion_window_and_anon_match(self):
        token = generate_click_token(
            {
                "click_id": "clk_789",
                "campaign_id": "cmp_xyz",
                "channel": "paid_social.meta",
                "occurred_at": "2025-11-10T12:00:00Z",
                "anon_id": "anon_hash",
            },
            "secret",
        )
        valid, decoded, _ = verify_click_token(token, "secret")
        self.assertTrue(valid)
        conversion_time = decoded["occurred_at"] + dt.timedelta(days=3)

        self.assertTrue(
            can_attribute_conversion(decoded, conversion_time, anon_hash="anon_hash", require_matching_anon=True)
        )
        late_conversion = decoded["occurred_at"] + dt.timedelta(days=10)
        self.assertFalse(can_attribute_conversion(decoded, late_conversion))
        self.assertFalse(
            can_attribute_conversion(decoded, conversion_time, anon_hash="another", require_matching_anon=True)
        )


if __name__ == "__main__":
    unittest.main()
