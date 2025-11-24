import unittest
from pathlib import Path

from tools.infra import common, preflight, rotation_report, smoke


REPO_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = REPO_ROOT / "ops" / "config" / "registry.md"
FLAGS_PATH = REPO_ROOT / "ops" / "config" / "flags.yaml"


class InfraToolsTestCase(unittest.TestCase):
    def test_parse_registry_returns_entries(self):
        entries = common.load_registry(REGISTRY_PATH)
        self.assertGreater(len(entries), 0)
        self.assertTrue(any(entry.key == "DB_SECRET_ARN" for entry in entries))

    def test_validate_registry_detects_plain_secret(self):
        entry = common.RegistryEntry(
            key="TEST_SECRET",
            service="api",
            env="prod",
            type="secret",
            default="—",
            allowed_values="must exist",
            secret_store="plain",
            owner="Security",
            rotation="90d",
            notes="",
        )
        errors = common.validate_registry([entry])
        self.assertIn("TEST_SECRET", " ".join(errors))

    def test_validate_flags_config_current(self):
        config = common.load_flags_config(FLAGS_PATH)
        errors = common.validate_flags_config(config)
        self.assertEqual(errors, [])

    def test_validate_flags_missing_fields(self):
        bad_config = {
            "flags": {
                "example-flag": {
                    "description": "missing owner",
                    "default_state": "off",
                    "environments": {"dev": "off", "stage": "off", "prod": "off"},
                    "kill_switch": "manual",
                }
            },
            "metadata": {
                "approvals_required": ["security@example.com"],
                "update_process": ["step"],
            },
        }
        errors = common.validate_flags_config(bad_config)
        self.assertTrue(errors)
        self.assertIn("missing fields", errors[0])

    def test_rotation_summary_buckets_include_secret(self):
        entries = common.load_registry(REGISTRY_PATH)
        summary = rotation_report.generate_rotation_summary(entries)
        buckets = summary["rotation_buckets"]
        self.assertIn("90d", buckets)
        self.assertIn("DB_SECRET_ARN", buckets["90d"])

    def test_preflight_checks_pass(self):
        results = preflight.run_checks(REPO_ROOT)
        failing = [result for result in results if not result.passed]
        self.assertFalse(
            failing, f"Expected all preflight checks to pass, failures: {failing}"
        )

    def test_smoke_report_all_checks_pass(self):
        report = smoke.run_smoke(REPO_ROOT)
        preflight_failures = [r for r in report.preflight_results if not r.passed]
        supplemental_failures = [r for r in report.supplemental_checks if not r.passed]
        self.assertFalse(preflight_failures, f"Preflight failures: {preflight_failures}")
        self.assertFalse(
            supplemental_failures,
            f"Supplemental failures: {supplemental_failures}",
        )


if __name__ == "__main__":
    unittest.main()
