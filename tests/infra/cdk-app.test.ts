import test from "node:test";
import assert from "node:assert/strict";
import { buildRastupApp } from "../../cdk/bin/infra.js";
import { ENVIRONMENT_LIST } from "../../cdk/config/environments.js";

test("CDK app synthesizes expected stacks", () => {
  const app = buildRastupApp();
  const assembly = app.synth();

  const stackIds = assembly.stacks.map((stack) => stack.stackName).sort();

  ENVIRONMENT_LIST.forEach((env) => {
    assert.ok(
      stackIds.includes(`RastupBudgets-${env.name}`),
      `missing budgets stack for ${env.name}`
    );
    assert.ok(
      stackIds.includes(`RastupIdentity-${env.name}`),
      `missing identity stack for ${env.name}`
    );
  });

  assert.ok(
    stackIds.includes("RastupOrganization"),
    "missing organization bootstrap stack"
  );
});

