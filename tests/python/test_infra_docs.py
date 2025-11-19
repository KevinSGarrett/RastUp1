import pathlib
import re
import unittest


DOC_PATH = pathlib.Path(__file__).resolve().parents[2] / "docs" / "infra" / "bootstrap-plan.md"


class InfraBootstrapDocumentationTest(unittest.TestCase):
    def setUp(self):
        if not DOC_PATH.exists():
            self.fail(f"Expected infrastructure roadmap at {DOC_PATH} but the file is missing.")
        self.content = DOC_PATH.read_text(encoding="utf-8")

    def test_required_headings_present(self):
        required_headings = [
            "## Context",
            "## Account & Environment Matrix",
            "## Amplify Gen 2 & CDK Structure",
            "## Security Baseline Tasks",
            "## CI/CD Pipeline Overview",
            "## Observability Foundation",
            "## Cost Controls",
            "## Implementation Phases",
            "## Testing & Validation Plan",
            "## Deliverables & Traceability",
        ]
        missing = [heading for heading in required_headings if heading not in self.content]
        self.assertFalse(missing, f"Missing required headings: {missing}")

    def test_no_placeholder_language(self):
        placeholders = re.findall(r"\bTBD\b|\bTODO\b", self.content, flags=re.IGNORECASE)
        self.assertFalse(
            placeholders,
            f"Found placeholder text in infrastructure roadmap: {placeholders}",
        )

    def test_environment_table_rows(self):
        # Ensure each environment row includes budgets and branch mapping
        rows = [
            line
            for line in self.content.splitlines()
            if line.startswith("| `rastup-") and "| " in line
        ]
        self.assertEqual(len(rows), 3, f"Expected 3 environment rows, got {len(rows)}")
        self.assertIn("Budgets", self.content)
        for row in rows:
            parts = [segment.strip() for segment in row.strip().split("|")]
            # columns after stripping empties: account, purpose, branch, budget, notes
            columns = [segment for segment in parts if segment]
            self.assertGreaterEqual(len(columns), 5, f"Row malformed: {row}")
            branch_column = columns[2]
            budget_column = columns[3]
            self.assertRegex(branch_column, r"`[^`]+`", f"Branch mapping missing in row: {row}")
            self.assertRegex(budget_column, r"\d", f"Budget value missing in row: {row}")


if __name__ == "__main__":
    unittest.main()
