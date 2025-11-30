import { StackBlueprint, StackFactory } from "../../types.js";

export const buildApiStack: StackFactory = (env) => {
  const stackId = `api-${env.name}`;
  const graphName = `rastup-${env.name}-appsync`;

  const resources: StackBlueprint["resources"] = [
    {
      id: `${stackId}-schema`,
      kind: "appsync",
      description:
        "AppSync GraphQL API with Cognito auth, IAM admin channel, and limited API key for dev.",
      config: {
        name: graphName,
        authModes: {
          primary: "COGNITO",
          additional: ["IAM", env.name === "dev" ? "API_KEY" : undefined].filter(
            Boolean
          ),
        },
        schemaPath: "schema/booking.graphql",
        xrayEnabled: true,
        logConfig: {
          level: env.name === "prod" ? "ERROR" : "ALL",
          excludeVerboseContent: env.name === "prod",
        },
        pipelineResolvers: [
          "authMiddleware",
          "inputValidation",
          "rateLimiter",
          "auditLogger",
        ],
      },
      alarms: [
        "appsync.5xx.rate",
        "appsync.authorization.errors",
        "appsync.latency.p95",
      ],
      featureFlags: [
        "enableAppSyncTracing",
        "enableOpenSearchServerless",
        "enableStripeFinancialConnections",
      ],
    },
    {
      id: `${stackId}-lambda-layer`,
      kind: "lambda",
      description: "Shared Lambda layer bundling domain handlers and observability.",
      config: {
        runtime: "nodejs20.x",
        packageDir: "services",
        environment: {
          POWERTOOLS_SERVICE_NAME: "bff",
          LOG_LEVEL: env.name === "prod" ? "INFO" : "DEBUG",
        },
        reservedConcurrency: env.name === "prod" ? 20 : 5,
        tracing: "ACTIVE",
      },
      compliance: ["SOC2-CC7", "PCI-DSS-10"],
      alarms: ["lambda.error.count", "lambda.duration.p99"],
    },
  ];

  return {
    id: stackId,
    title: "ApiStack",
    summary:
      "Defines the GraphQL API surface, Lambda resolvers, and shared runtime layer.",
    category: "api",
    resources,
    tags: {
      "rastup:stack": "api",
      "rastup:environment": env.name,
    },
  };
};

