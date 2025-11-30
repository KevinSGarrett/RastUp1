// amplify/functions/viewer/resource.ts
import { defineFunction } from "@aws-amplify/backend";

export const viewer = defineFunction({
  entry: "./handler.ts",
});
