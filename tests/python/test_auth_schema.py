"""Schema validation tests for WBS-003 auth system migration."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "db" / "migrations" / "028_auth_system.sql"


class AuthSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = SCHEMA_PATH.read_text(encoding="utf-8")
        cls.sql_lower = cls.sql.lower()

    def test_enums_defined(self) -> None:
        expected = {
            "auth.session_status": {"active", "revoked", "expired"},
            "auth.device_trust_level": {"unknown", "trusted", "revoked"},
            "auth.mfa_factor_type": {"sms_otp", "totp", "webauthn"},
            "auth.mfa_factor_status": {"pending", "active", "revoked"},
            "auth.login_outcome": {"success", "failure", "locked"},
        }

        for enum_name, values in expected.items():
            pattern = rf"create type {enum_name} as enum\s*\(([^)]+)\);"
            match = re.search(pattern, self.sql_lower)
            self.assertIsNotNone(match, f"{enum_name} missing from migration")
            if match:
                defined = {val.strip().strip("'\"") for val in match.group(1).split(",")}
                self.assertTrue(
                    values.issubset(defined),
                    f"{enum_name} missing values {values - defined}",
                )

    def test_tables_present(self) -> None:
        tables = [
            "auth.session",
            "auth.session_event",
            "auth.device_trust",
            "auth.mfa_factor",
            "auth.mfa_challenge",
            "auth.login_attempt",
            "auth.admin_elevation",
        ]

        for table in tables:
            with self.subTest(table=table):
                self.assertIn(
                    f"create table if not exists {table}",
                    self.sql_lower,
                    f"{table} definition missing",
                )

    def test_session_table_columns_and_checks(self) -> None:
        self.assertIn("refresh_hash text not null", self.sql_lower)
        self.assertIn("refresh_pepper_id text", self.sql_lower)
        self.assertIn("risk_score numeric(5, 3)", self.sql_lower)
        self.assertIn("revoked_reason text", self.sql_lower)
        self.assertIn("constraint chk_auth_session_expiry", self.sql_lower)
        self.assertIn("constraint chk_auth_session_idle", self.sql_lower)

    def test_indexes_exist(self) -> None:
        expected_indexes = [
            "idx_auth_session_user",
            "idx_auth_session_device",
            "idx_auth_session_status",
            "idx_auth_session_active_expiry",
            "idx_auth_device_trust_user",
            "idx_auth_mfa_factor_user_type",
            "idx_auth_mfa_challenge_active",
            "idx_auth_login_attempt_timestamp",
            "idx_auth_admin_elevation_active",
        ]

        for index in expected_indexes:
            with self.subTest(index=index):
                patterns = [
                    f"create index if not exists {index}",
                    f"create unique index if not exists {index}",
                ]
                self.assertTrue(
                    any(pattern in self.sql_lower for pattern in patterns),
                    f"{index} missing from migration",
                )


if __name__ == "__main__":
    unittest.main()
