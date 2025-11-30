import { StackBlueprint, StackFactory } from "../../types.js";

export const buildSearchStack: StackFactory = (env) => {
  const stackId = `search-${env.name}`;

  const resources: StackBlueprint["resources"] = [
    {
      id: `${stackId}-typesense`,
      kind: "typesense",
      description:
        "Typesense cluster for search indexing with optional OpenSearch Serverless adapter.",
      config: {
        instanceType: env.name === "prod" ? "small-x86" : "minimal",
        replicas: env.name === "prod" ? 2 : 1,
        snapshotRetentionDays: env.name === "prod" ? 14 : 7,
        apiKeySecretName: `TypesenseApiKey-${env.name}`,
        adapter: {
          type: "opensearch-serverless",
          enabled: env.name === "prod",
          ocuCap: 4,
        },
      },
      secrets: [
        {
          name: `TypesenseApiKey-${env.name}`,
          service: "secrets-manager",
          rotationDays: 30,
        },
      ],
      alarms: [
        "typesense.ocu.breach",
        "typesense.write.errors",
        "typesense.replication.lag",
      ],
      featureFlags: ["enableOpenSearchServerless"],
    },
    {
      id: `${stackId}-indexer`,
      kind: "lambda",
      description:
        "Indexer Lambda for streaming updates from EventBridge/SQS to Typesense/OpenSearch.",
      config: {
        runtime: "nodejs20.x",
        memorySize: 1024,
        timeoutSeconds: 60,
        reservedConcurrency: env.name === "prod" ? 10 : 2,
        environment: {
          SEARCH_CLUSTER: `typesense-${env.name}`,
          ENABLE_OPENSEARCH: env.name === "prod",
        },
      },
      alarms: ["lambda.indexer.errors", "lambda.indexer.duration.p95"],
    },
  ];

  return {
    id: stackId,
    title: "SearchStack",
    summary:
      "Search infrastructure including Typesense baseline and optional OpenSearch adapter.",
    category: "search",
    resources,
    tags: {
      "rastup:stack": "search",
      "rastup:environment": env.name,
    },
  };
};

