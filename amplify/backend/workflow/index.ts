import { StackBlueprint, StackFactory } from "../../types.js";

export const buildWorkflowStack: StackFactory = (env) => {
  const stackId = `workflow-${env.name}`;

  const resources: StackBlueprint["resources"] = [
    {
      id: `${stackId}-eventbridge`,
      kind: "eventbridge",
      description:
        "EventBridge bus orchestrating domain events and analytics fan-out.",
      config: {
        name: `rastup-${env.name}-events`,
        archiveDays: env.name === "prod" ? 365 : 90,
        rules: [
          { name: "booking-events", pattern: { detailType: ["booking.*"] } },
          { name: "search-events", pattern: { detailType: ["search.*"] } },
          { name: "notifications", pattern: { detailType: ["notification.*"] } },
        ],
      },
      alarms: ["eventbridge.failed.invocations"],
    },
    {
      id: `${stackId}-queues`,
      kind: "sqs",
      description:
        "SQS queues for async workflows (notifications, payouts, search indexing).",
      config: {
        queues: [
          { name: `notifications-${env.name}`, visibilityTimeout: 60 },
          { name: `payouts-${env.name}`, visibilityTimeout: 120 },
          { name: `indexing-${env.name}`, visibilityTimeout: 30 },
        ],
        deadLetterQueues: true,
        encryption: "KMS_MANAGED",
      },
      alarms: [
        "sqs.notifications.backlog",
        "sqs.payouts.backlog",
        "sqs.indexing.backlog",
      ],
    },
    {
      id: `${stackId}-sagas`,
      kind: "stepfunctions",
      description:
        "AWS Step Functions powering booking lifecycle, payouts, and document workflows.",
      config: {
        stateMachines: [
          { name: `booking-saga-${env.name}`, type: "STANDARD" },
          { name: `payout-saga-${env.name}`, type: "STANDARD" },
          { name: `document-saga-${env.name}`, type: "EXPRESS" },
        ],
        tracing: true,
        logging: "CLOUDWATCH",
      },
      alarms: [
        "stepfunctions.booking.failed",
        "stepfunctions.payout.failed",
        "stepfunctions.document.throttled",
      ],
    },
  ];

  return {
    id: stackId,
    title: "WorkflowStack",
    summary:
      "Queues, event bus, and Step Functions templates for core booking and comms sagas.",
    category: "workflow",
    resources,
    tags: {
      "rastup:stack": "workflow",
      "rastup:environment": env.name,
    },
  };
};

