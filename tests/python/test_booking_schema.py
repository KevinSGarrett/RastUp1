"""Schema validation tests for WBS-005 booking core migration."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "db" / "migrations" / "026_booking_core.sql"


class BookingSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = SCHEMA_PATH.read_text(encoding="utf-8")

    def test_enums_include_required_values(self) -> None:
        expected = {
            "lbg_status": {"draft", "awaiting_docs", "awaiting_payment", "confirmed", "in_progress", "completed", "cancelled", "failed"},
            "leg_status": {"draft", "awaiting_docs", "awaiting_payment", "confirmed", "in_progress", "completed", "cancelled", "failed"},
            "charge_status": {"requires_action", "authorized", "captured", "succeeded", "canceled", "failed"},
            "deposit_status": {"requires_action", "authorized", "captured", "voided", "expired"},
            "deposit_claim_status": {"pending", "approved", "denied", "captured", "voided"},
            "refund_status": {"pending", "succeeded", "failed"},
            "dispute_status": {"needs_response", "under_review", "won", "lost", "warning_closed"},
            "reserve_status": {"held", "pending_release", "released", "forfeited"},
            "finance_close_status": {"open", "in_progress", "succeeded", "failed"},
            "approval_status": {"pending", "approved", "rejected", "cancelled", "expired"},
            "approval_decision": {"approve", "reject", "cancel"},
            "receipt_kind": {"leg", "group", "refund"}
        }

        for enum_name, values in expected.items():
            with self.subTest(enum=enum_name):
                pattern = rf"create type booking\.{enum_name}\s+as\s+enum\s*\(([^;]+)\);"
                match = re.search(pattern, self.sql, flags=re.IGNORECASE | re.MULTILINE)
                self.assertIsNotNone(match, f"Enum booking.{enum_name} not found in migration.")
                defined = {val.strip().strip("'") for val in match.group(1).split(",")}
                self.assertTrue(values.issubset(defined), f"Enum booking.{enum_name} missing expected values {values - defined}")

    def test_tables_exist(self) -> None:
        required_tables = [
            "booking.lbg",
            "booking.booking_leg",
            "booking.charge",
            "booking.charge_split",
            "booking.deposit_auth",
            "booking.deposit_claim",
            "booking.amendment",
            "booking.payout",
            "booking.reserve_policy",
            "booking.reserve_ledger",
            "booking.tax_txn",
            "booking.refund",
            "booking.dispute",
            "booking.receipt_manifest",
            "booking.webhook_event",
            "booking.finance_daily_close",
            "booking.finance_daily_close_item",
            "booking.finance_approval_request",
            "booking.finance_approval_decision",
            "booking.finance_action_log",
            "booking.idempotency_record"
        ]
        for table in required_tables:
            with self.subTest(table=table):
                pattern = rf"create table if not exists {table}"
                self.assertRegex(self.sql, pattern, f"Table {table} missing from migration.")

    def test_booking_leg_totals_constraint_present(self) -> None:
        self.assertIn("constraint booking_leg_amounts", self.sql)
        self.assertIn("constraint booking_leg_profile_or_studio", self.sql)

    def test_deposit_claim_constraints_present(self) -> None:
        self.assertIn("deposit_claim_capture_bounds", self.sql)
        self.assertIn("constraint amendment_total_consistency", self.sql)


if __name__ == "__main__":
    unittest.main()
