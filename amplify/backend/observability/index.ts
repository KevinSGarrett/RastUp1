import { StackBlueprint, StackFactory } from "../../types.js";

export const buildObservabilityStack: StackFactory = (env) => {
  const stackId = `observability-${env.name}`;

  const resources: StackBlueprint["resources"] = [
    {
      id: `${stackId}-dashboards`,
      kind: "cloudwatch",
      description:
        "CloudWatch dashboards for latency, error rate, queue depth, and spend metrics.",
      config: {
        dashboards: [
          "AppLatency",
          "ErrorRate",
          "QueueDepth",
          "TypesenseOCU",
          "AuroraACU",
        ],
        sloTargets: {
          apiLatencyP95: 600,
          queueDrainMinutes: 5,
          checkoutAvailability: 99.9,
        },
      },
      alarms: [
        "cloudwatch.slo.burnrate",
        "cloudwatch.error.rate",
        "cloudwatch.queue.depth",
      ],
    },
    {
      id: `${stackId}-tracing`,
      kind: "lambda",
      description:
        "X-Ray/OpenTelemetry collectors bridging AppSync → Lambda → Aurora segments.",
      config: {
        runtime: "nodejs20.x",
        memorySize: 512,
        timeoutSeconds: 30,
        environment: {
          OTEL_EXPORTER: "otlp",
          OTEL_TARGET: `https://otel.${env.name}.rastup.com`,
        },
      },
      alarms: ["otel.exporter.errors"],
    },
    {
      id: `${stackId}-log-pipelines`,
      kind: "cloudwatch",
      description:
        "Firehose delivery streams ingesting logs into S3 + Glue Catalog with PII scrubbing.",
      config: {
        firehoseStreams: [
          { name: `api-logs-${env.name}`, destination: "s3" },
          { name: `frontend-logs-${env.name}`, destination: "s3" },
        ],
        glueCatalogDatabase: `rastup_logs_${env.name}`,
        piiScrubbers: ["email", "phone", "address", "payment_token"],
      },
      alarms: ["firehose.delivery.failures", "glue.partition.missing"],
    },
  ];

  return {
    id: stackId,
    title: "ObservabilityStack",
    summary:
      "Dashboards, tracing collectors, and log pipelines satisfying SLO and audit requirements.",
    category: "observability",
    resources,
    tags: {
      "rastup:stack": "observability",
      "rastup:environment": env.name,
    },
  };
};

