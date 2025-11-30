"""Schema validation tests for WBS-002 core base migration."""

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
        cls.sql_lower = cls.sql.lower()
        cls.type_definitions: dict[str, set[str]] = {}
        for match in re.finditer(
            r"create type core\.(\w+)\s+as\s+enum\s*\(([^;]+)\);",
            cls.sql_lower,
            flags=re.MULTILINE,
        ):
            type_name = match.group(1)
            values = {
                val.strip().strip("'\"")
                for val in match.group(2).split(",")
            }
            cls.type_definitions[type_name] = values

    def test_types_include_expected_values(self) -> None:
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
                "cancelled"
            },
            "privacy_tier": {"public", "tier1", "tier2", "restricted"},
            "pii_mask_strategy": {"none", "hash", "tokenize", "redact"}
        }

        for type_name, values in expected.items():
            with self.subTest(enum=type_name):
                defined = self.type_definitions.get(type_name)
                self.assertIsNotNone(defined, f"Type core.{type_name} not defined in migration.")
                self.assertTrue(values.issubset(defined), f"Type core.{type_name} missing values {values - set(defined or [])}")

    def test_tables_present(self) -> None:
        required_tables = [
            "core.user_account",
            "core.user_document",
            "core.service_profile",
            "core.studio",
            "core.studio_service_profile",
            "core.booking_order",
            "core.booking_leg",
            "core.booking_leg_addon",
            "core.booking_leg_history",
            "core.payment_intent",
            "core.payment_transaction",
            "core.message_thread",
            "core.message_participant",
            "core.message",
            "core.review",
            "core.promotion",
            "core.trust_case",
            "core.support_ticket",
            "core.analytics_event_bronze",
            "core.analytics_event_silver",
            "core.analytics_event_gold_daily",
            "core.dsar_request",
            "core.pii_mask_audit",
            "core.schema_contract_registry",
            "core.schema_contract_ci_gate",
            "core.lineage_edge"
        ]

        for table in required_tables:
            with self.subTest(table=table):
                self.assertIn(
                    f"create table if not exists {table}",
                    self.sql_lower,
                    f"Table {table} missing from migration."
                )

    def test_user_account_has_generated_hash_columns(self) -> None:
        self.assertIn("email_sha256 text generated always as", self.sql)
        self.assertIn("phone_sha256 text generated always as", self.sql)
        self.assertIn("create index if not exists idx_user_account_email_hash", self.sql)

    def test_booking_leg_time_constraint_present(self) -> None:
        self.assertIn("constraint chk_booking_leg_time", self.sql)

    def test_schema_contract_registry_uniqueness(self) -> None:
        self.assertRegex(
            self.sql,
            r"unique \(event_name, version\)",
            "schema_contract_registry must ensure unique contract versions."
        )

    def test_payment_transaction_has_kind_check(self) -> None:
        self.assertIn("check (kind in ('authorization', 'capture', 'refund', 'payout'))", self.sql)


if __name__ == "__main__":
    unittest.main()
