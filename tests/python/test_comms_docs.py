import pathlib
import re
import unittest


DOC_ROOT = pathlib.Path(__file__).resolve().parents[2] / "docs" / "ops" / "communications"


class CommunicationsDocumentationTest(unittest.TestCase):
    def setUp(self):
        if not DOC_ROOT.exists():
            self.fail(f"Expected communications documentation directory at {DOC_ROOT}")

    def test_blueprint_document_has_required_sections(self):
        doc_path = DOC_ROOT / "communications_system.md"
        self.assertTrue(doc_path.exists(), f"Missing communications blueprint: {doc_path}")
        content = doc_path.read_text(encoding="utf-8")

        required_headings = [
            "## Context",
            "## Scope Overview",
            "## High-Level Architecture",
            "## Data Model (Aurora Postgres)",
            "## Template Catalog (MVP Coverage)",
            "## Preferences & Quiet Hours Policy",
            "## Deliverability & Domain Authentication",
            "## Admin Console Requirements",
            "## Observability, Metrics & Alerts",
            "## Testing & QA Matrix",
            "## Implementation Phases",
            "## Risks & Mitigations",
            "## Traceability",
        ]
        missing = [heading for heading in required_headings if heading not in content]
        self.assertFalse(missing, f"Missing required headings in communications blueprint: {missing}")

        placeholders = re.findall(r"\bTBD\b|\bTODO\b", content, flags=re.IGNORECASE)
        self.assertFalse(placeholders, f"Blueprint contains unresolved placeholders: {placeholders}")

    def test_runbook_contains_playbooks_and_maintenance(self):
        runbook_path = DOC_ROOT / "runbook.md"
        self.assertTrue(runbook_path.exists(), f"Missing communications runbook: {runbook_path}")
        content = runbook_path.read_text(encoding="utf-8")

        self.assertIn("## Incident Response Playbooks", content)
        self.assertIn("## Maintenance Procedures", content)
        self.assertIn("## Escalation Matrix", content)

    def test_test_plan_matrix_present(self):
        plan_path = DOC_ROOT / "test_plan.md"
        self.assertTrue(plan_path.exists(), f"Missing communications test plan: {plan_path}")
        content = plan_path.read_text(encoding="utf-8")

        self.assertIn("## Test Matrix", content)
        self.assertIn("| Area | Objective | Type | Tools | Frequency |", content)
        self.assertIn("## Automated Test Suites", content)
        self.assertIn("## Reporting & Exit Criteria", content)


if __name__ == "__main__":
    unittest.main()
