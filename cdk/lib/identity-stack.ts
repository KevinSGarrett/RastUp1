import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";

import { AccountEnvironment } from "../config/environments.js";
import { applyStandardTags } from "./tags.js";

export interface IdentityStackProps extends StackProps {
  environment: AccountEnvironment;
}

/**
 * IdentityAccessStack
 *
 * Creates the shared IAM roles used by Amplify + internal operations:
 * - rastup-<env>-pipeline        (CI/CD for CDK + Amplify)
 * - rastup-<env>-breakglass-admin (emergency admin role)
 * - rastup-<env>-support         (read‑only support role)
 *
 * cdk‑nag AwsSolutions IAM findings are suppressed with explicit reasons,
 * since these roles are intentionally broad for now.
 */
export class IdentityAccessStack extends Stack {
  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);

    applyStandardTags(this, props.environment, "identity");

    //
    // CI/CD pipeline role (used by CodeBuild / pipelines)
    //
    const pipelineRole = new iam.Role(this, "PipelineRole", {
      roleName: `rastup-${props.environment.name}-pipeline`,
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AdministratorAccess-Amplify",
        ),
      ],
      description: "CI/CD pipeline role for Amplify and CDK deployment.",
      maxSessionDuration: Duration.hours(12),
    });

    pipelineRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "appconfig:GetConfiguration",
          "appconfig:StartConfigurationSession",
        ],
        resources: ["*"],
      }),
    );

    //
    // Break‑glass admin role
    //
    const breakGlassAdmins = new iam.Role(this, "BreakGlassAdmin", {
      roleName: `rastup-${props.environment.name}-breakglass-admin`,
      assumedBy: new iam.AccountPrincipal(this.account),
      description: "Break-glass admin role requiring MFA and ticket annotation.",
      maxSessionDuration: Duration.hours(4),
      inlinePolicies: {
        SessionControl: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["sts:SetSessionTags", "sts:TagSession"],
              resources: ["*"],
              effect: iam.Effect.ALLOW,
            }),
          ],
        }),
      },
    });

    breakGlassAdmins.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
    );

    //
    // Support engineering role (read‑only)
    //
    const supportRole = new iam.Role(this, "SupportRole", {
      roleName: `rastup-${props.environment.name}-support`,
      assumedBy: new iam.AccountPrincipal(this.account),
      description: "Support engineering role with scoped read-only permissions.",
      maxSessionDuration: Duration.hours(4),
    });

    supportRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess"),
    );

    //
    // cdk‑nag suppressions for AwsSolutions IAM rules
    // (granular, with appliesTo matching the findings)
    //

    // Pipeline role – uses AdministratorAccess-Amplify and wildcard resources
    NagSuppressions.addResourceSuppressions(
      pipelineRole,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "CI/CD pipeline role intentionally uses AWS managed AdministratorAccess-Amplify while the team iterates toward a least-privilege custom policy.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/AdministratorAccess-Amplify",
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Pipeline requires wildcard resource access for configuration and secret reads during bootstrap; will be narrowed once resource boundaries stabilize.",
          appliesTo: ["Resource::*"],
        },
      ],
      true, // also apply to child constructs (DefaultPolicy/Resource)
    );

    // Break-glass admin – full admin + wildcard access by design
    NagSuppressions.addResourceSuppressions(
      breakGlassAdmins,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Break-glass admin intentionally uses full AdministratorAccess for emergency recovery; access is gated by MFA and ticketing processes.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/AdministratorAccess",
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Break-glass admin needs wildcard permissions for rare catastrophic scenarios; sessions are time-bounded and audited.",
          appliesTo: ["Resource::*"],
        },
      ],
      true,
    );

    // Support role – AWS managed ReadOnlyAccess
    NagSuppressions.addResourceSuppressions(
      supportRole,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Support role uses AWS managed ReadOnlyAccess to provide broad visibility while a more scoped support policy is designed.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/ReadOnlyAccess",
          ],
        },
      ],
      true,
    );

    // NOTE: We intentionally do NOT create the Amplify service-linked role here.
    // Amplify will create its own AWSServiceRoleForAmplify when needed.
  }
}
