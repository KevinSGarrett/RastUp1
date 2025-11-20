import os
import unittest

from orchestrator.model_router import ModelRouter

class TestModelRouter(unittest.TestCase):
    def test_review_kind_returns_both(self):
        router = ModelRouter()
        plan = router.providers_for_kind("review")
        names = [p.name for (p, _model) in plan]
        self.assertIn("openai", names)
        self.assertIn("anthropic", names)
        self.assertEqual(len(plan), 2)

    def test_sweep_kind_can_be_openai_only(self):
        router = ModelRouter()
        plan = router.providers_for_kind("sweep")
        names = [p.name for (p, _model) in plan]
        self.assertEqual(names, ["openai"])
