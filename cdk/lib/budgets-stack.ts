// cdk/lib/budgets-stack.ts
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as budgets from "aws-cdk-lib/aws-budgets";
import { AccountEnvironment } from "../config/environments.js";
import { applyStandardTags } from "./tags.js";

export interface BudgetsStackProps extends StackProps {
  environment: AccountEnvironment;
}

export class BudgetsStack extends Stack {
  constructor(scope: Construct, id: string, props: BudgetsStackProps) {
    super(scope, id, props);

    const env = props.environment;

    // Tag all resources for this environment
    applyStandardTags(this, env, "budgets");

    // Use values from your environment definition if present,
    // otherwise fall back to something safe for dev
    const monthlyLimitUsd = env.budgets?.monthlyUsd ?? 25;

    // Make budget name unique per environment
    const budgetName = `rastup-${env.name}-monthly-budget-v1`;

    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: {
          amount: monthlyLimitUsd,
          unit: "USD",
        },
      },

      // NOTE: We intentionally do NOT define notificationsWithSubscribers here
      // yet. That is what was causing the "address: required but missing" error.
      // Once everything is deployed and stable, we can add alert thresholds
      // and subscribers back in a separate step.
    });
  }
}
