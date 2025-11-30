import { StackBlueprint, StackFactory } from "../types.js";
import { buildAdminStack } from "./admin/index.js";
import { buildApiStack } from "./api/index.js";
import { buildAuthStack } from "./auth/index.js";
import { buildCommsStack } from "./comms/index.js";
import { buildDataStack } from "./data/index.js";
import { buildMediaStack } from "./media/index.js";
import { buildObservabilityStack } from "./observability/index.js";
import { buildSearchStack } from "./search/index.js";
import { buildWorkflowStack } from "./workflow/index.js";

export const STACK_FACTORIES: Record<string, StackFactory> = {
  auth: buildAuthStack,
  api: buildApiStack,
  data: buildDataStack,
  workflow: buildWorkflowStack,
  media: buildMediaStack,
  search: buildSearchStack,
  observability: buildObservabilityStack,
  comms: buildCommsStack,
  admin: buildAdminStack,
};

export const buildStacksForEnvironment = (
  stackFactories: typeof STACK_FACTORIES,
  factoryOrder: Array<keyof typeof STACK_FACTORIES>,
  create: (factory: StackFactory) => StackBlueprint
): StackBlueprint[] => {
  return factoryOrder.map((key) => {
    const factory = stackFactories[key];
    if (!factory) {
      throw new Error(`Missing stack factory for key: ${String(key)}`);
    }
    return create(factory);
  });
};

