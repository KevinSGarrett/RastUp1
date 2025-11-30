export type EnvironmentName = "dev" | "stage" | "prod";

export type ResourceKind =
  | "cognito"
  | "appsync"
  | "lambda"
  | "aurora"
  | "dynamodb"
  | "s3"
  | "cloudfront"
  | "eventbridge"
  | "sqs"
  | "stepfunctions"
  | "waf"
  | "quicksight"
  | "cloudwatch"
  | "typesense"
  | "kms"
  | "appconfig"
  | "sns"
  | "iam";

export interface EnvironmentConfig {
  name: EnvironmentName;
  accountId: string;
  region: string;
  description: string;
  branchPatterns: string[];
  primaryDomain: string;
  notificationEmail: string;
  previewTtlHours: number;
  budgets: {
    monthlyUsd: number;
    alertThresholdPercents: number[];
  };
}

export interface SecretRotationPolicy {
  name: string;
  service: "secrets-manager" | "appconfig";
  rotationDays: number;
}

export interface ResourceBlueprint {
  id: string;
  kind: ResourceKind;
  description: string;
  compliance?: string[];
  config: Record<string, unknown>;
  alarms?: string[];
  featureFlags?: string[];
  secrets?: SecretRotationPolicy[];
}

export interface StackBlueprint {
  id: string;
  title: string;
  summary: string;
  category:
    | "auth"
    | "api"
    | "data"
    | "workflow"
    | "media"
    | "search"
    | "observability"
    | "comms"
    | "admin";
  resources: ResourceBlueprint[];
  tags?: Record<string, string>;
}

export interface AmplifyBlueprint {
  environment: EnvironmentConfig;
  stacks: StackBlueprint[];
  branchMapping: Array<{
    pattern: string;
    environment: EnvironmentName;
  }>;
  featureFlags: Record<string, boolean>;
  secrets: SecretRotationPolicy[];
}

export type StackFactory = (
  env: EnvironmentConfig
) => StackBlueprint;

