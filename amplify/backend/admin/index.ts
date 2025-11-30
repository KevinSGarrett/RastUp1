import { StackBlueprint, StackFactory } from "../../types.js";

export const buildAdminStack: StackFactory = (env) => {
  const stackId = `admin-${env.name}`;

  const resources: StackBlueprint["resources"] = [
    {
      id: `${stackId}-rbac-seed`,
      kind: "lambda",
      description:
        "Administrative seed jobs to bootstrap Amplify Admin UI access and RBAC assignments.",
      config: {
        runtime: "nodejs20.x",
        timeoutSeconds: 60,
        memorySize: 256,
        handler: "functions/admin/rbac-seed.handler",
        environment: {
          ADMIN_GROUP: "admin",
          SUPPORT_GROUP: "support",
        },
      },
      alarms: ["lambda.rbacseed.failures"],
    },
    {
      id: `${stackId}-audit-log`,
      kind: "s3",
      description:
        "Centralized audit log bucket for admin operations with Glacier archival.",
      config: {
        name: `rastup-${env.name}-audit-logs`,
        blockPublicAccess: true,
        glacierAfterDays: 365,
        retentionYears: 7,
      },
      compliance: ["SOX-302", "SOC2-CC2"],
      alarms: ["s3.audit.access.denied", "s3.audit.replication.failed"],
    },
    {
      id: `${stackId}-break-glass`,
      kind: "iam",
      description:
        "Break-glass IAM roles with MFA enforcement and automatic expiration.",
      config: {
        roles: [
          { name: `BreakGlassAdmin-${env.name}`, maxSessionHours: 4 },
          { name: `BreakGlassDBA-${env.name}`, maxSessionHours: 2 },
        ],
        requireTicketId: true,
      },
      compliance: ["ISO27001-A.9.4"],
      alarms: ["iam.breakglass.access"],
    },
  ];

  return {
    id: stackId,
    title: "AdminStack",
    summary:
      "Admin experience including RBAC seeding, audit logging, and break-glass controls.",
    category: "admin",
    resources,
    tags: {
      "rastup:stack": "admin",
      "rastup:environment": env.name,
    },
  };
};

