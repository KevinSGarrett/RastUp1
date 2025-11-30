// amplify/auth/resource.ts
import { defineAuth } from '@aws-amplify/backend';

/**
 * Core auth for Rastup dev:
 * - Email-based login
 * - Cognito user groups for RBAC
 *
 * This matches the blueprint groups:
 *   buyer, seller, studio_owner, admin, trust, support, finance
 */
export const auth = defineAuth({
  // Sign-in / sign-up flow
  loginWith: {
    email: true, // email-based username
  },

  // Cognito user groups for RBAC
  groups: [
    'buyer',
    'seller',
    'studio_owner',
    'admin',
    'trust',
    'support',
    'finance',
  ],

  // TODO (later):
  // - add MFA policies when we harden stage/prod
  // - add postConfirmation trigger to seed profiles / default groups
});
