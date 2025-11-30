#!/usr/bin/env node
import "source-map-support/register.js";
import { App, Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { ENVIRONMENT_LIST } from "../config/environments.js";
import { OrgBootstrapStack } from "../lib/org-stack.js";
import { BudgetsStack } from "../lib/budgets-stack.js";
import { IdentityAccessStack } from "../lib/identity-stack.js";

export const buildRastupApp = (): App => {
  const app = new App();

  const managementAccountId =
    process.env.MANAGEMENT_ACCOUNT_ID ??
    process.env.CDK_DEFAULT_ACCOUNT ??
    "000000000000";
  const managementRegion =
    process.env.MANAGEMENT_REGION ??
    process.env.CDK_DEFAULT_REGION ??
    "us-east-1";

  new OrgBootstrapStack(app, "RastupOrganization", {
    env: {
      account: managementAccountId,
      region: managementRegion,
    },
    organizationName: "rastup",
    environments: ENVIRONMENT_LIST,
    description:
      "Bootstrap AWS Organizations structure, guardrails, and service control policies for Rastup environments.",
  });

  ENVIRONMENT_LIST.forEach((environment) => {
    new BudgetsStack(app, `RastupBudgets-${environment.name}`, {
      env: {
        account: environment.account,
        region: environment.region,
      },
      environment,
      description: `Financial guardrails for ${environment.name} environment.`,
    });

    new IdentityAccessStack(app, `RastupIdentity-${environment.name}`, {
      env: {
        account: environment.account,
        region: environment.region,
      },
      environment,
      description: `IAM roles and break-glass controls for ${environment.name}.`,
    });
  });

  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

  return app;
};

const app = buildRastupApp();
app.synth();
