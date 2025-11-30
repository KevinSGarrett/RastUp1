// amplify/backend.ts
import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";

/**
 * Amplify Gen 2 backend root.
 *
 * This wires up Auth + Data. We can hang additional resources
 * (api, storage, etc.) off this same backend definition.
 */
defineBackend({
  auth,
  data,
});
