import { StackBlueprint, StackFactory } from "../../types.js";

export const buildCommsStack: StackFactory = (env) => {
  const stackId = `comms-${env.name}`;

  const resources: StackBlueprint["resources"] = [
    {
      id: `${stackId}-ses`,
      kind: "sns",
      description:
        "SES identities and bounce/complaint feedback loops for transactional email.",
      config: {
        identities: [
          `notify.${env.name}.rastup.com`,
          `no-reply.${env.name}.rastup.com`,
        ],
        feedbackTopics: {
          bounce: `arn:aws:sns:${env.region}:${env.accountId}:ses-bounce-${env.name}`,
          complaint: `arn:aws:sns:${env.region}:${env.accountId}:ses-complaint-${env.name}`,
        },
        dmarcPolicy: env.name === "prod" ? "reject" : "quarantine",
      },
      alarms: [
        "ses.bounce.rate",
        "ses.complaint.rate",
        "ses.sending.pause",
      ],
    },
    {
      id: `${stackId}-notifications`,
      kind: "lambda",
      description:
        "Notification dispatcher bridging AppSync subscriptions, push, email, and SMS.",
      config: {
        runtime: "nodejs20.x",
        timeoutSeconds: 30,
        memorySize: 512,
        retries: 2,
        environment: {
          EMAIL_TOPIC_ARN: `arn:aws:sns:${env.region}:${env.accountId}:ses-${env.name}`,
          SMS_TOPIC_ARN: `arn:aws:sns:${env.region}:${env.accountId}:sms-${env.name}`,
          PUSH_TOPIC_ARN: `arn:aws:sns:${env.region}:${env.accountId}:push-${env.name}`,
        },
      },
      alarms: ["lambda.notifications.errors", "lambda.notifications.throttles"],
    },
  ];

  return {
    id: stackId,
    title: "CommsStack",
    summary:
      "Transactional communications pipeline with SES identities and notification workers.",
    category: "comms",
    resources,
    tags: {
      "rastup:stack": "comms",
      "rastup:environment": env.name,
    },
  };
};

