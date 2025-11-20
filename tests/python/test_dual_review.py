import os
import unittest

from orchestrator.model_router import ModelRouter
from orchestrator.review_latest import compile_dual_review

class TestDualReview(unittest.TestCase):
    def test_compile_dual_review_stub(self):
        os.environ["ORCHESTRATOR_LLM_STUB"] = "1"
        merged = compile_dual_review("dummy run report", ModelRouter())
        self.assertIn("Assistant‑Manager Review", merged)
        self.assertIn("Final Orchestrator Decision", merged)
