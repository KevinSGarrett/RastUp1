import {
  AmplifyBlueprint,
  EnvironmentName,
  StackBlueprint,
} from "./types.js";
import {
  BASELINE_SECRETS,
  BRANCH_MAPPING,
  DEFAULT_FEATURE_FLAGS,
  ENVIRONMENTS,
  buildAmplifyEnvironmentBlueprint,
} from "./config/environments.js";
import {
  STACK_FACTORIES,
  buildStacksForEnvironment,
} from "./backend/index.js";

const STACK_ORDER: Array<keyof typeof STACK_FACTORIES> = [
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

export const createAmplifyBlueprint = (
  environment: EnvironmentName
): AmplifyBlueprint => {
  const envConfig = ENVIRONMENTS[environment];
  if (!envConfig) {
    throw new Error(`Unknown Amplify environment: ${environment}`);
  }

  const stacks = buildStacksForEnvironment(
    STACK_FACTORIES,
    STACK_ORDER,
    (factory) => factory(envConfig)
  );

  verifyResourceUniqueness(envConfig.name, stacks);

  return buildAmplifyEnvironmentBlueprint(environment, stacks);
};

export const enumerateAmplifyBlueprints = (): AmplifyBlueprint[] => {
  return (Object.keys(ENVIRONMENTS) as EnvironmentName[]).map((name) =>
    createAmplifyBlueprint(name)
  );
};

export const summarizeAmplifyBlueprint = (
  blueprint: AmplifyBlueprint
): Record<string, unknown> => {
  const stackSummaries = blueprint.stacks.map((stack) => ({
    id: stack.id,
    category: stack.category,
    resources: stack.resources.length,
  }));

  return {
    environment: blueprint.environment,
    stacks: stackSummaries,
    featureFlags: blueprint.featureFlags,
    secrets: blueprint.secrets,
    branchMapping: blueprint.branchMapping,
  };
};

const verifyResourceUniqueness = (
  environment: EnvironmentName,
  stacks: StackBlueprint[]
): void => {
  const ids = new Set<string>();
  for (const stack of stacks) {
    for (const resource of stack.resources) {
      const key = `${stack.id}:${resource.id}`;
      if (ids.has(key)) {
        throw new Error(
          `Duplicate resource id detected for environment ${environment}: ${key}`
        );
      }
      ids.add(key);
    }
  }
};

export const amplifyGuardrails = {
  stackOrder: STACK_ORDER,
  branchMapping: BRANCH_MAPPING,
  defaultFeatureFlags: DEFAULT_FEATURE_FLAGS,
  secrets: BASELINE_SECRETS,
};

