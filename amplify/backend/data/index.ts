import { StackBlueprint, StackFactory } from "../../types.js";

export const buildDataStack: StackFactory = (env) => {
  const stackId = `data-${env.name}`;
  const auroraClusterId = `rastup-${env.name}-aurora`;

  const resources: StackBlueprint["resources"] = [
    {
      id: `${stackId}-aurora`,
      kind: "aurora",
      description:
        "Aurora PostgreSQL Serverless v2 cluster housing transactional data (core, finance, trust).",
      config: {
        clusterIdentifier: auroraClusterId,
        engineVersion: "15.4",
        minCapacity: env.name === "prod" ? 1 : 0.5,
        maxCapacity: env.name === "prod" ? 8 : 4,
        backupRetentionDays: env.name === "prod" ? 35 : 7,
        copyTagsToSnapshot: true,
        preferredMaintenanceWindow: "Sun:04:00-Sun:06:00",
        vpcSubnets: ["private-a", "private-b"],
        performanceInsightsEnabled: true,
      },
      compliance: ["PII-02", "SOX-404"],
      secrets: [
        {
          name: `AuroraClusterAdmin-${env.name}`,
          service: "secrets-manager",
          rotationDays: 30,
        },
      ],
      alarms: [
        "aurora.acu.throttle",
        "aurora.replica.lag",
        "aurora.storage.free",
      ],
    },
    {
      id: `${stackId}-dynamodb`,
      kind: "dynamodb",
      description:
        "DynamoDB tables for presence, messaging dedupe, promotions, and trust cache.",
      config: {
        tables: [
          { name: `presence-${env.name}`, ttlAttribute: "expiresAt", billing: "PAY_PER_REQUEST" },
          { name: `comms_dedupe-${env.name}`, ttlAttribute: "expiresAt", billing: "PAY_PER_REQUEST" },
          { name: `promo_active_by_city-${env.name}`, billing: "PROVISIONED", readCapacity: 5, writeCapacity: 2 },
          { name: `trust_cache-${env.name}`, billing: "PROVISIONED", readCapacity: 10, writeCapacity: 5 },
        ],
        pointInTimeRecovery: env.name !== "dev",
        streams: "NEW_AND_OLD_IMAGES",
      },
      alarms: [
        "dynamodb.throttle.read",
        "dynamodb.throttle.write",
        "dynamodb.ttl.failed",
      ],
    },
    {
      id: `${stackId}-secrets`,
      kind: "kms",
      description:
        "Customer-managed KMS keys for Aurora, DynamoDB, Typesense volumes, and S3 buckets.",
      config: {
        keys: [
          { alias: `alias/rastup/${env.name}/aurora`, rotation: true },
          { alias: `alias/rastup/${env.name}/dynamodb`, rotation: true },
          { alias: `alias/rastup/${env.name}/typesense`, rotation: true },
        ],
        keyAdministrators: [
          `arn:aws:iam::${env.accountId}:role/InfraAdmin`,
        ],
      },
      alarms: ["kms.failed.rotation", "kms.disabled.key"],
    },
  ];

  return {
    id: stackId,
    title: "DataStack",
    summary:
      "Data plane resources including Aurora, DynamoDB supporting caches, and KMS encryption.",
    category: "data",
    resources,
    tags: {
      "rastup:stack": "data",
      "rastup:environment": env.name,
    },
  };
};

