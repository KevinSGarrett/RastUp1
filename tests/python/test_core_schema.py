"""Schema validation tests for WBS-002 core backend migration."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "db" / "migrations" / "021_core_base.sql"


class CoreSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = SCHEMA_PATH.read_text(encoding="utf-8")

    def test_enums_include_expected_values(self) -> None:
        expected = {
            "user_status": {"pending", "active", "suspended", "closed"},
            "service_profile_status": {"draft", "pending_review", "published", "suspended"},
            "booking_status": {"draft", "pending", "confirmed", "in_session", "completed", "cancelled"},
            "booking_leg_status": {"draft", "pending", "confirmed", "in_session", "completed", "cancelled"},
            "payment_status": {
                "requires_payment_method",
                "requires_confirmation",
                "authorized",
                "captured",
                "refunded",
                "failed",
                "cancelled",
            },
            "privacy_tier": {"public", "tier1", "tier2", "restricted"},
            "pii_mask_strategy": {"none", "hash", "tokenize", "redact"},
        }

        for enum_name, values in expected.items():
            with self.subTest(enum=enum_name):
                pattern = rf"create type if not exists {enum_name}\s+as\s+enum\s*\(([^;]+)\);"
                match = re.search(pattern, self.sql, flags=re.IGNORECASE | re.MULTILINE)
                self.assertIsNotNone(match, f"Enum {enum_name} not found in migration.")
                defined = {val.strip().strip("'") for val in match.group(1).split(",")}
                self.assertTrue(values.issubset(defined), f"Enum {enum_name} missing expected values: {values - defined}")

    def test_core_tables_exist(self) -> None:
        required_tables = [
            "app_user",
            "user_profile_document",
            "service_profile",
            "studio",
            "studio_service_profile",
            "booking",
            "booking_leg",
            "booking_leg_addon",
            "booking_leg_history",
            "payment_intent",
            "payment_transaction",
            "message_thread",
            "message_participant",
            "message",
            "review",
            "promotion",
            "trust_case",
            "idv_status",
            "bg_status",
            "social_verification",
            "trust_badge",
            "trust_risk_signal",
            "support_ticket",
            "analytics_event_bronze",
            "analytics_event_silver",
            "analytics_event_gold_daily",
            "dsar_request",
            "pii_mask_audit",
            "schema_contract_registry",
            "schema_contract_ci_gate",
            "lineage_edge",
        ]

        for table in required_tables:
            with self.subTest(table=table):
                pattern = rf"create table if not exists {table}"
                self.assertRegex(self.sql, pattern, f"Table {table} missing from migration.")

    def test_service_profile_constraints(self) -> None:
        self.assertIn("cardinality(languages) <= 5", self.sql)
        self.assertIn("cardinality(tags) <= 12", self.sql)
        self.assertIn("jsonb_typeof(about_fields) = 'object'", self.sql)
        self.assertIn("jsonb_typeof(pricing_fields) = 'array'", self.sql)

    def test_booking_leg_constraints_present(self) -> None:
        self.assertIn("constraint booking_leg_time", self.sql)
        self.assertIn("constraint booking_leg_total", self.sql)
        self.assertIn("unique (booking_id, service_profile_id)", self.sql)

    def test_privacy_tier_pipeline_tables_have_generated_hash(self) -> None:
        self.assertIn("generated always as (hashtext(dimensions::text)) stored", self.sql)


if __name__ == "__main__":
    unittest.main()
