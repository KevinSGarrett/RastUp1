import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import { AccountEnvironment } from "../config/environments.js";

export const applyStandardTags = (
  scope: Construct,
  env: AccountEnvironment,
  component: string
): void => {
  Tags.of(scope).add("rastup:environment", env.name);
  Tags.of(scope).add("rastup:component", component);
  Tags.of(scope).add("rastup:managed-by", "cdk");
};

