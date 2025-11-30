import {
  amplifyGuardrails,
  createAmplifyBlueprint,
  enumerateAmplifyBlueprints,
} from "../stack.js";
import { EnvironmentName } from "../types.js";

const [, , environmentArg] = process.argv;

const emitBlueprint = (env?: EnvironmentName) => {
  if (env) {
    const blueprint = createAmplifyBlueprint(env);
    return {
      guardrails: amplifyGuardrails,
      blueprint,
    };
  }

  return {
    guardrails: amplifyGuardrails,
    blueprints: enumerateAmplifyBlueprints(),
  };
};

try {
  const payload = emitBlueprint(environmentArg as EnvironmentName | undefined);
  process.stdout.write(JSON.stringify(payload, null, 2));
  process.stdout.write("\n");
} catch (error) {
  console.error(
    JSON.stringify(
      {
        message: "Failed to produce Amplify blueprint",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}

