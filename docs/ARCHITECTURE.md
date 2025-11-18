# RastUp Platform Architecture

**Version:** 1.0  
**Last Updated:** 2025-11-18  
**Owner:** Engineering Leadership

## Executive Summary

RastUp is a US-based creative marketplace platform connecting Models, Photographers, Videographers, and Content Creators. The platform enables service discovery, booking, secure payments, and collaboration while maintaining strict trust & safety standards, privacy compliance, and operational excellence.

This document provides a comprehensive architectural overview of the platform's technical design, covering infrastructure, data flows, security boundaries, and operational patterns.

## Architecture Principles

1. **City-First Rollout**: All features ship behind city-specific feature flags, enabling controlled expansion and localized tuning.
2. **Least Privilege**: IAM policies, KMS keys, and RBAC enforce minimal access with JIT elevation for sensitive operations.
3. **Privacy by Design**: PII is masked by default, redacted in logs, and subject to automated lifecycle policies.
4. **Immutable Audit Trail**: All sensitive operations emit events to tamper-evident audit logs with chain hashing and WORM storage.
5. **Fail-Safe Defaults**: Safe-mode content filtering, read-only fallbacks, and circuit breakers protect users and data integrity.
6. **Observability First**: Structured logging, distributed tracing, and real-time dashboards enable rapid detection and response.

## System Context

### External Actors

- **Service Providers**: Models, Photographers, Videographers, Content Creators offering bookable services
- **Clients**: Users seeking to book creative services
- **Admin/Support**: Internal staff managing operations, trust & safety, and dispute resolution
- **External Services**: Stripe (payments), Plaid (identity), Twilio (communications), AWS (infrastructure)

### Core Capabilities

1. **Identity & Access**: Account creation, authentication, role-based authorization, verification
2. **Service Profiles**: Multi-role profiles with portfolios, rates, availability, and reviews
3. **Search & Discovery**: Typesense/OpenSearch-powered search with promotions and safe-mode filtering
4. **Booking & Payments**: Checkout, escrow, milestone-based releases, dispute resolution
5. **Messaging & Collaboration**: Real-time chat, file sharing, booking context
6. **Content Management**: Media upload, processing, moderation, NSFW gating
7. **Trust & Safety**: Verification, background checks, content moderation, reporting
8. **Admin Console**: Operational tooling for support, trust, finance, and engineering teams

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Applications                       │
│  Web (React/Next.js) │ Mobile (React Native) │ Admin Console    │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ HTTPS / GraphQL / REST
                 │
┌────────────────▼────────────────────────────────────────────────┐
│                     API Gateway / CDN                            │
│  CloudFront │ WAF │ Rate Limiting │ Bot Control                 │
└────────────────┬────────────────────────────────────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼────┐  ┌───▼────┐  ┌───▼────┐
│ GraphQL│  │  REST  │  │ WebSocket│
│  API   │  │  API   │  │  Server  │
└───┬────┘  └───┬────┘  └───┬────┘
    │           │           │
    └───────────┼───────────┘
                │
┌───────────────▼───────────────────────────────────────────────┐
│                     Application Services                       │
│  Auth │ Profiles │ Search │ Booking │ Messaging │ Media       │
│  Trust & Safety │ Payments │ Notifications │ Analytics        │
└───────────────┬───────────────────────────────────────────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼────┐  ┌──▼─────┐  ┌─▼──────┐
│ Aurora │  │ DynamoDB│  │ S3     │
│ Postgres│ │ Cache   │  │ Media  │
└────────┘  └─────────┘  └────────┘
```

## Infrastructure Layers

### 1. Edge & CDN Layer

- **CloudFront**: Global CDN for static assets and API responses
- **AWS WAF**: Protection against OWASP Top 10, bot control, rate limiting
- **Route 53**: DNS with health checks and failover
- **Shield Standard**: DDoS protection

**Security Controls**:
- Geo-blocking (US-only)
- Custom WAF rules for abuse patterns
- Rate limiting per IP/user/endpoint
- Bot detection and CAPTCHA challenges

### 2. API Layer

- **GraphQL API**: Primary client interface (Apollo Server)
- **REST API**: Legacy endpoints and webhooks
- **WebSocket Server**: Real-time messaging and notifications
- **API Gateway**: Request routing, authentication, throttling

**Key Patterns**:
- JWT-based authentication with short-lived tokens
- GraphQL schema stitching for service composition
- DataLoader for N+1 query optimization
- Request/response logging with PII redaction

### 3. Application Services

#### Auth Service
- User registration, login, password reset
- OAuth integration (Google, Apple)
- Session management and token refresh
- MFA enforcement for sensitive operations

#### Profile Service
- Multi-role service profile management
- Portfolio and media associations
- Rates, packages, and availability
- Public/private field visibility

#### Search Service
- Typesense primary, OpenSearch fallback
- Outbox-based indexing pipeline
- Promotions and boost logic
- Safe-mode content filtering

#### Booking Service
- Checkout flow and cart management
- Escrow and milestone tracking
- Acceptance and dispute workflows
- Calendar integration

#### Messaging Service
- Real-time chat with WebSocket
- File attachments and media sharing
- Booking context and smart replies
- Notification triggers

#### Media Service
- Upload to S3 with presigned URLs
- Image/video processing pipeline
- Thumbnail generation and optimization
- NSFW detection and moderation queue

#### Trust & Safety Service
- Identity verification (Plaid)
- Background check integration
- Content moderation workflows
- Reporting and escalation

#### Payment Service
- Stripe integration for escrow
- Payout scheduling and tax reporting
- Refund and dispute handling
- Transaction ledger and reconciliation

#### Notification Service
- Email (SendGrid/SES)
- SMS (Twilio)
- Push notifications (FCM/APNs)
- In-app notifications

#### Analytics Service
- Event ingestion (Bronze/Silver/Gold)
- KPI computation and dashboards
- Experimentation framework
- Data warehouse integration

### 4. Data Layer

#### Aurora PostgreSQL
- **Primary Database**: Transactional data
- **Multi-AZ**: High availability
- **Read Replicas**: Query offloading
- **Encryption**: At-rest (KMS) and in-transit (TLS)

**Key Schemas**:
- `users`: Accounts and authentication
- `profiles`: Service profiles and metadata
- `bookings`: Transactions and escrow
- `messages`: Chat history
- `audit`: Immutable event log

#### DynamoDB
- **Session Store**: Active sessions and tokens
- **Cache Layer**: Search results and API responses
- **Rate Limiting**: Token bucket counters
- **Feature Flags**: AppConfig integration

#### S3
- **Media Storage**: User-uploaded content
- **Audit Logs**: Immutable event streams
- **Backups**: Database and configuration snapshots
- **Static Assets**: CDN-served resources

#### Typesense
- **Search Index**: Primary search engine
- **Collections**: Models, Photographers, Videographers, Creators
- **Synonyms**: Curated synonym sets
- **Promotions**: Boosted results with density caps

#### OpenSearch
- **Fallback Search**: Hot-standby for Typesense
- **Log Analytics**: Operational log queries
- **Alerting**: Anomaly detection

### 5. Integration Layer

- **Stripe**: Payment processing and escrow
- **Plaid**: Identity verification
- **Twilio**: SMS and voice
- **SendGrid/SES**: Email delivery
- **FCM/APNs**: Push notifications
- **Google/Apple OAuth**: Social login

## Data Flow Patterns

### 1. User Registration & Verification

```
Client → GraphQL API → Auth Service → Aurora (users)
                    ↓
                Plaid API (IDV)
                    ↓
            Trust Service → Aurora (verifications)
                    ↓
            Event Bus → Notification Service → Email/SMS
```

### 2. Search & Discovery

```
Client → GraphQL API → Search Service → DynamoDB Cache (hit?)
                                      ↓ (miss)
                                  Typesense Query
                                      ↓
                              Search Results + Promotions
                                      ↓
                          DynamoDB Cache (write) → Client
```

### 3. Booking & Payment

```
Client → GraphQL API → Booking Service → Aurora (bookings)
                                      ↓
                              Stripe API (escrow)
                                      ↓
                          Payment Service → Aurora (transactions)
                                      ↓
                      Event Bus → Notification Service → Email/SMS
```

### 4. Content Moderation

```
Media Upload → S3 (presigned URL)
            ↓
    Lambda Trigger → Media Service
            ↓
    NSFW Detection (Rekognition)
            ↓
    Moderation Queue (if flagged)
            ↓
    Trust Service → Aurora (moderation_queue)
            ↓
    Admin Console (review)
```

## Security Architecture

### Authentication & Authorization

- **JWT Tokens**: Short-lived (15 min) access tokens, long-lived (30 day) refresh tokens
- **RBAC**: Role-based access control (User, Provider, Admin, Support, Trust, Finance)
- **MFA**: Required for admin operations and sensitive actions
- **JIT Elevation**: Time-limited elevated permissions with audit trail

### Encryption

- **At-Rest**: KMS-encrypted databases, S3 buckets, and secrets
- **In-Transit**: TLS 1.3 for all external and internal communications
- **Key Rotation**: Automated 90-day rotation for KMS keys and secrets

### Network Security

- **VPC**: Isolated network with private subnets for databases
- **Security Groups**: Least-privilege firewall rules
- **NACLs**: Network-level access control
- **VPN/Bastion**: Secure admin access to infrastructure

### Audit & Compliance

- **Immutable Audit Log**: Chain-hashed event stream with WORM storage
- **PII Redaction**: Automated masking in logs and telemetry
- **Access Logs**: CloudFront, ALB, and API Gateway logs
- **Compliance**: PCI DSS Level 1, GDPR, CCPA readiness

## Operational Patterns

### Deployment

- **Infrastructure as Code**: Terraform/CDK for all resources
- **CI/CD**: GitHub Actions with automated testing and security scans
- **Blue/Green Deployments**: Zero-downtime releases
- **Feature Flags**: City-gated rollouts with kill switches

### Monitoring & Alerting

- **Metrics**: CloudWatch, Datadog, or custom dashboards
- **Logs**: Structured JSON logs with correlation IDs
- **Tracing**: Distributed tracing with X-Ray or Jaeger
- **Alerts**: PagerDuty integration for on-call rotation

### Disaster Recovery

- **RTO**: 4 hours for critical services
- **RPO**: 15 minutes for transactional data
- **Backups**: Automated daily snapshots with 30-day retention
- **Runbooks**: Documented procedures for common failure scenarios

### Scaling Strategy

- **Horizontal Scaling**: Auto-scaling groups for stateless services
- **Vertical Scaling**: Aurora read replicas and instance upgrades
- **Caching**: Multi-layer caching (CDN, API, database)
- **Sharding**: City-based data partitioning for future growth

## Technology Stack

### Backend
- **Runtime**: Node.js (TypeScript)
- **Framework**: Express, Apollo Server
- **ORM**: Prisma or TypeORM
- **Testing**: Jest, Supertest

### Frontend
- **Web**: React, Next.js
- **Mobile**: React Native
- **State Management**: Redux or Zustand
- **Testing**: Jest, React Testing Library, Cypress

### Infrastructure
- **Cloud**: AWS
- **Compute**: ECS Fargate, Lambda
- **Database**: Aurora PostgreSQL, DynamoDB
- **Search**: Typesense, OpenSearch
- **Storage**: S3, CloudFront
- **Messaging**: SQS, SNS, EventBridge

### DevOps
- **IaC**: Terraform or AWS CDK
- **CI/CD**: GitHub Actions
- **Monitoring**: CloudWatch, Datadog
- **Secrets**: AWS Secrets Manager
- **Logging**: CloudWatch Logs, S3

## Key Design Decisions

See `docs/adrs/` for detailed Architecture Decision Records covering:
- ADR-001: Multi-role service profile design
- ADR-002: Typesense over Algolia for search
- ADR-003: Escrow payment flow with Stripe
- ADR-004: Outbox pattern for search indexing
- ADR-005: City-gated feature flag strategy

## References

- **Blueprint Index**: `docs/blueprints/blueprint_index.json`
- **Security Documentation**: `docs/security/README.md`
- **Runbooks**: `ops/runbooks/`
- **API Schema**: `api/schema/`
- **Data Models**: `db/migrations/`
- **Observability**: `observability/`

## Maintenance

This document should be updated whenever:
- New services or infrastructure components are added
- Major architectural patterns change
- Security or compliance requirements evolve
- Technology stack decisions are made

**Review Cadence**: Quarterly or before major releases
