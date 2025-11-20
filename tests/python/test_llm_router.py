# tests/python/test_llm_router.py
import json
import os
import subprocess
import sys
import unittest

from orchestrator.llm_router import get_router, LLMResult, coerce_to_result


class LLMRouterTest(unittest.TestCase):
    def test_coerce_to_result_handles_none(self):
        r = coerce_to_result("stub", "x", None)
        self.assertIsInstance(r, LLMResult)
        self.assertEqual(r.text, "")
        self.assertEqual(r.provider, "stub")
        self.assertEqual(r.model, "x")

    def test_stub_complete_round_trip(self):
        router = get_router(provider_name="stub", model="unit-test")
        out = router.complete("hello world")
        self.assertIsInstance(out, LLMResult)
        self.assertIn("hello world", out.text.lower())
        self.assertEqual(out.provider, "stub")
        self.assertEqual(out.model, "unit-test")

    def test_cli_json_with_messages_works(self):
        cmd = [
            sys.executable, "-m", "orchestrator.llm_router",
            "--messages", json.dumps([{"role": "user", "content": "Ping?"}]),
            "-p", "stub", "--as-json"
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, text=True)
        self.assertEqual(res.returncode, 0, msg=f"stderr: {res.stderr}")
        payload = json.loads(res.stdout.strip() or "{}")
        self.assertIn("text", payload)
        self.assertEqual(payload.get("provider"), "stub")
        self.assertIn("Ping?", payload.get("text", ""))


if __name__ == "__main__":
    unittest.main()
