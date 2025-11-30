import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as organizations from "aws-cdk-lib/aws-organizations";
import { AccountEnvironment } from "../config/environments.js";
import { applyStandardTags } from "./tags.js";

export interface OrgStackProps extends StackProps {
  organizationName: string;
  environments: AccountEnvironment[];
}

export class OrgBootstrapStack extends Stack {
  constructor(scope: Construct, id: string, props: OrgStackProps) {
    super(scope, id, props);

    const root = new organizations.CfnOrganizationalUnit(this, "RootOu", {
      name: props.organizationName,
      parentId: "r-root",
    });

    props.environments.forEach((environment) => {
      const ou = new organizations.CfnOrganizationalUnit(
        this,
        `${environment.name.toUpperCase()}Ou`,
        {
          name: environment.rootOu,
          parentId: root.attrId,
        }
      );

      new organizations.CfnPolicy(this, `${environment.name}Guardrails`, {
        name: `scp-${environment.name}`,
        type: "SERVICE_CONTROL_POLICY",
        content: {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "DenyLegacyAmplify",
              Effect: "Deny",
              Action: [
                "amplify:CreateApp",
                "amplify:CreateBranch",
                "amplify:CreateBackendEnvironment",
              ],
              Resource: "*",
              Condition: {
                StringLike: {
                  "aws:RequestedRegion": ["us-east-1"],
                },
              },
            },
            {
              Sid: "DenyWildcardIam",
              Effect: "Deny",
              Action: "iam:CreatePolicy",
              Resource: "*",
              Condition: {
                StringEquals: {
                  "aws:ResourceTag/rastup:managed-by": "cdk",
                },
              },
            },
          ],
        },
        description: `Guardrails for ${environment.name} preventing legacy Amplify Classic and wildcard IAM.`,
        targetIds: [ou.attrId],
      });

      applyStandardTags(ou, environment, "organizations");

      new CfnOutput(this, `${environment.name}OuId`, {
        value: ou.attrId,
        description: `Organizational Unit ID for ${environment.name}`,
      });
    });
  }
}

