"""Tests for event manifest integrity."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from tools.validate_event_contracts import MANIFEST_PATH, validate_manifest


class EventManifestTest(unittest.TestCase):
    def test_manifest_passes_validator(self) -> None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        problems = validate_manifest(manifest)
        self.assertEqual(
            problems,
            [],
            f"Expected manifest to be clean, found issues: {problems}"
        )


if __name__ == "__main__":
    unittest.main()
