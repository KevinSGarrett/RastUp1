import test from "node:test";
import assert from "node:assert/strict";
import {
  amplifyGuardrails,
  createAmplifyBlueprint,
  enumerateAmplifyBlueprints,
} from "../../amplify/stack.js";
import { EnvironmentName, StackBlueprint } from "../../amplify/types.js";

const EXPECTED_STACK_COUNT = 9;

const EXPECTED_STACK_IDS: Array<StackBlueprint["category"]> = [
  "auth",
  "api",
  "data",
  "workflow",
  "media",
  "search",
  "observability",
  "comms",
  "admin",
];

test("Amplify blueprint generates all required stacks per environment", () => {
  const blueprints = enumerateAmplifyBlueprints();
  assert.equal(blueprints.length, 3, "expected three environments");

  const environments = blueprints.map((bp) => bp.environment.name).sort();
  assert.deepEqual(environments, ["dev", "prod", "stage"]);

  blueprints.forEach((blueprint) => {
    assert.equal(
      blueprint.stacks.length,
      EXPECTED_STACK_COUNT,
      `expected ${EXPECTED_STACK_COUNT} stacks for ${blueprint.environment.name}`
    );

    const stackKeys = blueprint.stacks.map((stack) => stack.category);
    EXPECTED_STACK_IDS.forEach((expected) =>
      assert.ok(
        stackKeys.includes(expected),
        `missing stack category ${expected} in ${blueprint.environment.name}`
      )
    );
  });
});

test("Amplify blueprint enforces branch mapping guardrails", () => {
  const devBlueprint = createAmplifyBlueprint("dev");
  const patterns = devBlueprint.branchMapping.map((mapping) => mapping.pattern);
  assert.ok(patterns.includes("feature/*"));
  assert.ok(patterns.includes("develop"));

  assert.equal(amplifyGuardrails.branchMapping.length > 0, true);
  assert.ok(amplifyGuardrails.defaultFeatureFlags.enforceAmplifyGen2);
});

test("Amplify blueprint ensures resource identifiers unique per environment", () => {
  (["dev", "stage", "prod"] as EnvironmentName[]).forEach((env) => {
    const blueprint = createAmplifyBlueprint(env);
    const resourceKeys = new Set<string>();
    blueprint.stacks.forEach((stack) => {
      stack.resources.forEach((resource) => {
        const key = `${stack.id}:${resource.id}`;
        assert.ok(!resourceKeys.has(key), `duplicate resource id ${key}`);
        resourceKeys.add(key);
      });
    });
  });
});

