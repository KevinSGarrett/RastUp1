import { StackBlueprint, StackFactory } from "../../types.js";

export const buildMediaStack: StackFactory = (env) => {
  const stackId = `media-${env.name}`;

  const resources: StackBlueprint["resources"] = [
    {
      id: `${stackId}-s3`,
      kind: "s3",
      description:
        "S3 buckets for public assets, user uploads, rendered documents, and raw logs.",
      config: {
        buckets: [
          { name: `rastup-${env.name}-public-assets`, public: false, website: false },
          { name: `rastup-${env.name}-user-previews`, public: false },
          { name: `rastup-${env.name}-docs-rendered`, public: false },
          { name: `rastup-${env.name}-logs-raw`, public: false, lifecycle: { glacierAfterDays: 180 } },
        ],
        blockPublicAccess: true,
        intelligentTieringAfterDays: 30,
        defaultEncryption: "SSE-S3",
      },
      compliance: ["PCI-DSS-3", "PII-03"],
      alarms: ["s3.public.access.attempt", "s3.replication.failed"],
    },
    {
      id: `${stackId}-cloudfront`,
      kind: "cloudfront",
      description:
        "CloudFront distribution with WAF integration and Lambda@Edge image transforms.",
      config: {
        domainNames: [env.primaryDomain],
        wafAclArn: `arn:aws:wafv2:${env.region}:${env.accountId}:regional/webacl/rastup-${env.name}`,
        originShield: env.region,
        loggingBucket: `rastup-${env.name}-logs-raw`,
        lambdaAtEdge: [
          { name: "image-resize", path: "functions/media/image-resizer" },
        ],
      },
      alarms: ["cloudfront.5xx.spike", "cloudfront.waf.blocks"],
    },
    {
      id: `${stackId}-waf`,
      kind: "waf",
      description:
        "WAF Bot Control rules and rate limiting for auth, search, and checkout paths.",
      config: {
        scope: "CLOUDFRONT",
        rules: [
          { name: "AWS-AWSManagedRulesBotControlRuleSet" },
          { name: "AWS-AWSManagedRulesCommonRuleSet" },
          {
            name: "RateLimitAuth",
            rateLimit: env.name === "prod" ? 200 : 500,
            conditions: { uriPath: "/auth/*" },
          },
          {
            name: "RateLimitSearch",
            rateLimit: env.name === "prod" ? 600 : 800,
            conditions: { uriPath: "/api/search/*" },
          },
        ],
      },
      alarms: ["waf.blocked.requests.spike"],
    },
  ];

  return {
    id: stackId,
    title: "MediaStack",
    summary:
      "Storage, CDN, and web application firewall footprint required for web/mobile clients.",
    category: "media",
    resources,
    tags: {
      "rastup:stack": "media",
      "rastup:environment": env.name,
    },
  };
};

