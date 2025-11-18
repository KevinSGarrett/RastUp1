import json
import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class SecurityControlsTestCase(unittest.TestCase):
    def read_text(self, relative_path: str) -> str:
        return (REPO_ROOT / relative_path).read_text(encoding="utf-8")

    def test_registry_contains_required_entries(self):
        registry = self.read_text("ops/config/registry.md")
        for token in (
            "`KMS_KEY_AUDIT_LOG`",
            "`AUDIT_LOG_CHAIN_SALT`",
            "`RBAC_JIT_ROLE_ARN`",
            "`DSAR_SIGNING_KEY_ARN`",
            "`WAF_RATE_LIMIT`",
        ):
            with self.subTest(token=token):
                self.assertIn(token, registry, f"{token} missing from registry")

    def test_flags_yaml_mentions_security_controls(self):
        flags = self.read_text("ops/config/flags.yaml")
        self.assertIn("global-readonly", flags)
        self.assertIn("search-rate-limit-tighten", flags)
        self.assertIn("BOTCONTROL", flags.upper())  # ensures doc references BotControl flag description

    def test_log_schema_json_is_valid(self):
        doc = self.read_text("observability/log_schema.md")
        match = re.search(r"```json\n(.*?)\n```", doc, flags=re.DOTALL)
        self.assertIsNotNone(match, "JSON example missing from log schema doc")
        example = match.group(1)
        try:
            json.loads(example)
        except json.JSONDecodeError as exc:
            self.fail(f"log schema example invalid JSON: {exc}")

    def test_audit_logging_describes_chain_hash(self):
        doc = self.read_text("docs/security/audit_logging.md")
        self.assertIn("chain hash", doc.lower())
        self.assertIn("Object Lock", doc)
        self.assertIn("KMS_KEY_AUDIT_LOG", doc)

    def test_privacy_workflow_mentions_dsar_signing_key(self):
        doc = self.read_text("docs/security/privacy_operations.md")
        self.assertIn("DSAR_SIGNING_KEY_ARN", doc)
        self.assertIn("legal hold", doc.lower())
        self.assertIn("3m45s", doc)  # evidence from drill log

    def test_data_retention_matrix_includes_users_and_messages(self):
        doc = self.read_text("privacy/data_lifecycle.md")
        self.assertIn("`users`", doc)
        self.assertIn("Account lifetime + 30 days", doc)
        self.assertIn("messages", doc)
        self.assertIn("Glue workflow", doc)

    def test_pci_dss_scope_mentions_stripe(self):
        doc = self.read_text("docs/security/pci_dss.md")
        self.assertIn("Stripe Connect", doc)
        self.assertIn("SAQ-A", doc)
        self.assertIn("Webhook", doc)

    def test_rbac_doc_mentions_mfa(self):
        doc = self.read_text("docs/security/rbac_and_mfa.md")
        self.assertIn("hardware security keys", doc.lower())
        self.assertIn("temporary credential", doc.lower())
        self.assertIn("Joiner / Mover / Leaver", doc)

    def test_waf_doc_lists_rate_limit_rule(self):
        doc = self.read_text("docs/security/waf_bot_control.md")
        self.assertIn("scraper-rate-limit", doc)
        self.assertIn("Bot Control", doc)
        self.assertIn("WAF logs", doc)

    def test_incident_runbook_severity_table(self):
        doc = self.read_text("ops/runbooks/incident_response.md")
        self.assertIn("| 3 | Critical", doc)
        self.assertIn("global-readonly", doc)
        self.assertTrue(
            "SEV2 tabletop" in doc or "tabletop exercises" in doc,
            "Drill reference missing from incident runbook",
        )

    def test_training_doc_has_pen_test_and_asv_scan(self):
        doc = self.read_text("docs/security/training_and_drills.md")
        self.assertIn("External penetration test", doc)
        self.assertIn("PCI ASV scan", doc)
        self.assertIn("Phishing simulation", doc)


if __name__ == "__main__":
    unittest.main()
