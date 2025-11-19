"""Schema validation tests for WBS-007 Smart Docs migration."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "db" / "migrations" / "027_smart_docs.sql"


class SmartDocsSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = SCHEMA_PATH.read_text(encoding="utf-8")

    def test_enums_include_expected_values(self) -> None:
        expected = {
            "pack_status": {"draft", "issued", "signed", "voided", "superseded"},
            "envelope_status": {"none", "sent", "completed", "voided", "expired"},
            "sign_event_type": {
                "envelope_sent",
                "recipient_viewed",
                "recipient_signed",
                "envelope_completed",
                "envelope_declined",
                "envelope_voided",
                "envelope_expired",
            },
        }

        for enum_name, values in expected.items():
            with self.subTest(enum=enum_name):
                pattern = rf"create type smart_docs\.{enum_name}\s+as\s+enum\s*\(([^;]+)\);"
                match = re.search(pattern, self.sql, flags=re.IGNORECASE | re.MULTILINE)
                self.assertIsNotNone(match, f"Enum smart_docs.{enum_name} not found.")
                defined = {val.strip().strip("'") for val in match.group(1).split(",")}
                self.assertTrue(
                    values.issubset(defined),
                    f"Enum smart_docs.{enum_name} missing values {values - defined}",
                )

    def test_tables_exist(self) -> None:
        required_tables = [
            "smart_docs.clause",
            "smart_docs.template",
            "smart_docs.pack",
            "smart_docs.doc_instance",
            "smart_docs.sign_event",
            "smart_docs.legal_hold",
        ]

        for table in required_tables:
            with self.subTest(table=table):
                pattern = rf"create table if not exists {table}"
                self.assertRegex(self.sql, pattern, f"Table {table} missing from migration.")

    def test_constraints_present(self) -> None:
        self.assertIn("unique (leg_id, status) deferrable initially deferred", self.sql)
        self.assertIn("constraint pack_worm_retention_future", self.sql)
        self.assertIn("constraint doc_instance_worm_retention_future", self.sql)
        self.assertIn("unique (doc_id, provider_event_id) where provider_event_id is not null", self.sql)
        self.assertIn("unique (doc_id) where released_at is null", self.sql)

    def test_touch_triggers_exist(self) -> None:
        self.assertIn("trg_smart_docs_pack_touch", self.sql)
        self.assertIn("trg_smart_docs_doc_instance_touch", self.sql)


if __name__ == "__main__":
    unittest.main()
