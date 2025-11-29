// amplify/backend.ts
import { defineBackend } from '@aws-amplify/backend';

// For now, this is just an empty backend so that `ampx sandbox` can run.
// We’ll wire in actual auth/api/data resources later.
defineBackend({});
