diff --git a/orchestrator/policy.py b/orchestrator/policy.py
@@
-REVIEW_POLICY = ProviderPolicy(
-    assistant_manager=ProviderSpec(
-        provider="openai",
-        models=["gpt-4o-mini"],
-        fallbacks=["gpt-4o", "gpt-3.5-turbo"],
-    ),
-    primary_decider=ProviderSpec(
-        provider="anthropic",
-        models=["claude-3-5-haiku-20241022"],
-        fallbacks=["claude-3-haiku-20240307"],
-    ),
-)
+REVIEW_POLICY = ProviderPolicy(
+    # Manager (final decider) — OpenAI
+    primary_decider=ProviderSpec(
+        provider="openai",
+        models=["gpt-4o"],
+        fallbacks=["gpt-4o-mini", "gpt-3.5-turbo"],
+    ),
+    # Assistant manager (secondary review) — Anthropic
+    assistant_manager=ProviderSpec(
+        provider="anthropic",
+        models=["claude-3-5-haiku-20241022"],
+        fallbacks=["claude-3-haiku-20240307"],
+    ),
+)
