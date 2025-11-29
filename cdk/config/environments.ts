import { Environment } from "aws-cdk-lib";

export type EnvironmentName = "dev" | "stage" | "prod";

export interface AccountEnvironment extends Environment {
  name: EnvironmentName;
  account: string;
  region: string;
  rootOu: string;
  branchPatterns: string[];
  domain: string;
  budgets: {
    monthlyUsd: number;
    alertThresholdPercents: number[];
    notificationEmails: string[];
  };
}

export const ACCOUNT_ENVIRONMENTS: Record<EnvironmentName, AccountEnvironment> =
  {
    dev: {
      name: "dev",
      account: "029530099913",
      region: "us-east-1",
      rootOu: "OU-DEV",
      branchPatterns: ["develop", "feature/*"],
      domain: "app.dev.rastup.com",
      budgets: {
        monthlyUsd: 25,
        alertThresholdPercents: [20, 50, 80, 100],
        notificationEmails: ["infra-alerts-dev@rastup.com"],
      },
    },
    stage: {
      name: "stage",
      account: "029530099913",
      region: "us-east-1",
      rootOu: "OU-STAGE",
      branchPatterns: ["main"],
      domain: "app.stage.rastup.com",
      budgets: {
        monthlyUsd: 60,
        alertThresholdPercents: [20, 40, 60, 80, 100],
        notificationEmails: ["infra-alerts-stage@rastup.com"],
      },
    },
    prod: {
      name: "prod",
      account: "029530099913",
      region: "us-east-1",
      rootOu: "OU-PROD",
      branchPatterns: ["release/*"],
      domain: "app.rastup.com",
      budgets: {
        monthlyUsd: 100,
        alertThresholdPercents: [20, 40, 60, 80, 100],
        notificationEmails: ["infra-alerts-prod@rastup.com", "finops@rastup.com"],
      },
    },
  };

export const ENVIRONMENT_LIST = Object.values(
  ACCOUNT_ENVIRONMENTS
) as AccountEnvironment[];

