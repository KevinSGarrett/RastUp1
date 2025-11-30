import {
  AmplifyBlueprint,
  EnvironmentConfig,
  EnvironmentName,
} from "../types.js";

const DEV_ACCOUNT_ID = "029530099913";
const STAGE_ACCOUNT_ID = "029530099913";
const PROD_ACCOUNT_ID = "029530099913";

export const ENVIRONMENTS: Record<EnvironmentName, EnvironmentConfig> = {
  dev: {
    name: "dev",
    accountId: DEV_ACCOUNT_ID,
    region: "us-east-1",
    description: "Developer sandbox with ephemeral preview support.",
    branchPatterns: ["develop", "feature/*"],
    primaryDomain: "app.dev.rastup.com",
    notificationEmail: "infra-alerts-dev@rastup.com",
    previewTtlHours: 48,
    budgets: {
      monthlyUsd: 25,
      alertThresholdPercents: [20, 50, 80, 100],
    },
  },
  stage: {
    name: "stage",
    accountId: STAGE_ACCOUNT_ID,
    region: "us-east-1",
    description: "Pre-production staging with DR drills enabled.",
    branchPatterns: ["main"],
    primaryDomain: "app.stage.rastup.com",
    notificationEmail: "infra-alerts-stage@rastup.com",
    previewTtlHours: 0,
    budgets: {
      monthlyUsd: 60,
      alertThresholdPercents: [20, 40, 60, 80, 100],
    },
  },
  prod: {
    name: "prod",
    accountId: PROD_ACCOUNT_ID,
    region: "us-east-1",
    description: "Production account serving live customer traffic.",
    branchPatterns: ["release/*"],
    primaryDomain: "app.rastup.com",
    notificationEmail: "infra-alerts-prod@rastup.com",
    previewTtlHours: 0,
    budgets: {
      monthlyUsd: 100,
      alertThresholdPercents: [20, 40, 60, 80, 100],
    },
  },
};

export const BRANCH_MAPPING: AmplifyBlueprint["branchMapping"] = [
  { pattern: "feature/*", environment: "dev" },
  { pattern: "develop", environment: "dev" },
  { pattern: "main", environment: "stage" },
  { pattern: "release/*", environment: "prod" },
];

export const DEFAULT_FEATURE_FLAGS: AmplifyBlueprint["featureFlags"] = {
  enableAppSyncTracing: true,
  enableStripeFinancialConnections: false,
  enableOpenSearchServerless: false,
  enableMediaConvert: false,
  enableInstantPayouts: false,
  enforceAmplifyGen2: true,
};

export const BASELINE_SECRETS: AmplifyBlueprint["secrets"] = [
  {
    name: "AuroraClusterAdmin",
    service: "secrets-manager",
    rotationDays: 30,
  },
  {
    name: "StripeApiKey",
    service: "secrets-manager",
    rotationDays: 60,
  },
  {
    name: "DropboxSignApiKey",
    service: "secrets-manager",
    rotationDays: 90,
  },
  {
    name: "AppConfigFeatureFlags",
    service: "appconfig",
    rotationDays: 7,
  },
];

export const buildAmplifyEnvironmentBlueprint = (
  environment: EnvironmentName,
  stacks: AmplifyBlueprint["stacks"]
): AmplifyBlueprint => {
  const envConfig = ENVIRONMENTS[environment];
  return {
    environment: envConfig,
    stacks,
    branchMapping: BRANCH_MAPPING,
    featureFlags: {
      ...DEFAULT_FEATURE_FLAGS,
      enableOpenSearchServerless:
        environment === "prod" ? true : DEFAULT_FEATURE_FLAGS.enableOpenSearchServerless,
    },
    secrets: BASELINE_SECRETS,
  };
};

