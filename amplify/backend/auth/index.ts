import { StackBlueprint, StackFactory } from "../../types.js";

export const buildAuthStack: StackFactory = (env) => {
  const stackId = `auth-${env.name}`;
  const userPoolName = `rastup-${env.name}-users`;

  const resources: StackBlueprint["resources"] = [
    {
      id: `${stackId}-user-pool`,
      kind: "cognito",
      description:
        "Amazon Cognito User Pool providing email + social auth with MFA policies.",
      config: {
        userPoolName,
        mfa: env.name === "prod" ? "OPTIONAL" : "OFF",
        oauthProviders: ["COGNITO", "APPLE", "GOOGLE"],
        passwordPolicy: {
          minLength: 12,
          requireSymbols: true,
          tempPasswordValidityDays: 7,
        },
        groups: [
          "buyer",
          "seller",
          "studio_owner",
          "admin",
          "trust",
          "support",
          "finance",
        ],
      },
      secrets: [
        {
          name: `CognitoAppClientSecret-${env.name}`,
          service: "secrets-manager",
          rotationDays: env.name === "prod" ? 30 : 60,
        },
      ],
      alarms: ["auth.signin.error.rate", "auth.mfa.challenge.failure"],
    },
    {
      id: `${stackId}-identity-pool`,
      kind: "cognito",
      description:
        "Identity pool enabling scoped IAM access for direct S3 uploads and AppSync.",
      config: {
        name: `rastup-${env.name}-identity`,
        roleMappings: [
          { group: "buyer", iamRole: `buyer-${env.name}` },
          { group: "seller", iamRole: `seller-${env.name}` },
          { group: "admin", iamRole: `admin-${env.name}` },
        ],
        unauthenticatedRole: env.name === "dev",
      },
      compliance: ["PII-01", "SOC2-CC6"],
      alarms: ["identity.unmatched.role.mappings"],
    },
  ];

  return {
    id: stackId,
    title: "AuthStack",
    summary:
      "Provision Cognito pools, identity federation, and RBAC baseline for Amplify.",
    category: "auth",
    resources,
    tags: {
      "rastup:stack": "auth",
      "rastup:environment": env.name,
    },
  };
};
