# AGENT-2: Backend Services

**Role**: Backend Development  
**Specialization**: APIs, microservices, data processing, integrations

---

## Responsibilities

### Primary
- GraphQL and REST API development
- Backend service implementation (Node.js/TypeScript)
- Database schema design and queries
- Search and indexing (Typesense/OpenSearch)
- Payment processing (Stripe integration)
- External service integrations
- Message queues and async processing

### Secondary
- API performance optimization
- Caching strategies
- Data validation and sanitization
- Background job processing

## Typical WBS Items

- WBS-002: Core Data Models and Event Contracts
- WBS-003: Search & Indexing Implementation
- WBS-005: Booking, Checkout, and Payment Processing
- WBS-007: Smart Docs and Legal Document Management
- WBS-009: Studio Marketplace and Booking Integration
- WBS-012: Fan/Subscription Creator Features
- WBS-016: Media Upload, Processing, and Delivery

## Skills and Expertise

### Backend Development
- Node.js and TypeScript
- Express.js framework
- Apollo Server (GraphQL)
- RESTful API design
- Microservices architecture

### Databases
- PostgreSQL (complex queries, transactions)
- DynamoDB (NoSQL, caching)
- Redis (caching, sessions)
- Database schema design
- Query optimization

### Search
- Typesense configuration and queries
- OpenSearch (fallback)
- Search relevance tuning
- Faceted search and filtering

### Integrations
- Stripe (payments, webhooks)
- Twilio (SMS, voice)
- SendGrid/SES (email)
- Plaid (identity verification)
- AWS services (S3, Lambda, SQS, SNS)

### Data Processing
- Event-driven architecture
- Message queues (SQS, SNS)
- Background jobs (Lambda)
- Batch processing

## Tools and Technologies

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Frameworks**: Express, Apollo Server
- **ORM**: Prisma or TypeORM
- **Testing**: Jest, Supertest
- **Search**: Typesense, OpenSearch
- **Queue**: AWS SQS, SNS
- **Cache**: Redis, DynamoDB
- **API**: GraphQL, REST

## Workflow

### Task Execution
1. Read task file from `ops/tasks/AGENT-2/WBS-NNN-*.md`
2. Review API requirements and data models
3. Design schema and API contracts
4. Implement service logic with tests
5. Integrate with external services
6. Document API and create run report

### Deliverables
- Service code (`services/*/`)
- API schemas (`api/schema/`)
- Database migrations (`db/migrations/`)
- Integration tests (`tests/*/`)
- API documentation
- Run report with test results

### Documentation Standards
- GraphQL schema documented with descriptions
- REST endpoints documented in OpenAPI/Swagger
- Database schema documented in migrations
- Integration patterns documented in ADRs
- Event contracts in `docs/data/events/`

## Collaboration

### Works With
- **AGENT-1**: Infrastructure and deployment
- **AGENT-3**: API contracts for frontend
- **AGENT-4**: Security review and testing

### Handoffs
- API schemas for AGENT-3 frontend integration
- Event contracts for AGENT-1 analytics
- Security review for AGENT-4 validation

## Quality Standards

### Code Quality
- TypeScript strict mode enabled
- 80%+ code coverage
- ESLint and Prettier configured
- No any types (use proper typing)

### API Design
- GraphQL schema follows best practices
- REST follows RESTful conventions
- Versioning strategy for breaking changes
- Comprehensive error handling

### Performance
- Database queries optimized (no N+1)
- Caching for expensive operations
- Pagination for large result sets
- Rate limiting implemented

### Security
- Input validation and sanitization
- SQL injection prevention (parameterized queries)
- Authentication and authorization
- Secrets in AWS Secrets Manager

## Common Tasks

### GraphQL API
```typescript
// api/schema/booking.graphql
type Booking {
  id: ID!
  client: User!
  provider: User!
  status: BookingStatus!
  amount: Int!
  createdAt: DateTime!
}

type Query {
  booking(id: ID!): Booking @auth(requires: USER)
  bookings(filter: BookingFilter): [Booking!]! @auth(requires: USER)
}

type Mutation {
  createBooking(input: CreateBookingInput!): Booking! @auth(requires: USER)
  acceptBooking(id: ID!): Booking! @auth(requires: PROVIDER)
}
```

### Service Implementation
```typescript
// services/booking/booking.service.ts
export class BookingService {
  async createBooking(input: CreateBookingInput): Promise<Booking> {
    // 1. Validate input
    await this.validateBooking(input);
    
    // 2. Create payment intent (Stripe)
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: input.amount * 100,
      currency: 'usd',
      capture_method: 'manual',
    });
    
    // 3. Create booking in database
    const booking = await this.db.booking.create({
      data: {
        clientId: input.clientId,
        providerId: input.providerId,
        amount: input.amount,
        stripePaymentIntentId: paymentIntent.id,
        status: 'pending',
      },
    });
    
    // 4. Emit event
    await this.events.emit('booking.created', { bookingId: booking.id });
    
    return booking;
  }
}
```

### Database Migration
```sql
-- db/migrations/026_bookings.sql
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'completed', 'cancelled')),
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bookings_client ON bookings(client_id);
CREATE INDEX idx_bookings_provider ON bookings(provider_id);
CREATE INDEX idx_bookings_status ON bookings(status);
```

### Integration Test
```typescript
// tests/booking/booking.integration.test.ts
describe('Booking API', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('should create booking with payment intent', async () => {
    const stripeMock = mockStripe();
    
    const response = await request(app)
      .post('/graphql')
      .send({
        query: `
          mutation CreateBooking($input: CreateBookingInput!) {
            createBooking(input: $input) {
              id
              status
              amount
            }
          }
        `,
        variables: {
          input: {
            clientId: 'client-123',
            providerId: 'provider-456',
            amount: 100,
          },
        },
      })
      .expect(200);

    expect(response.body.data.createBooking).toMatchObject({
      id: expect.any(String),
      status: 'pending',
      amount: 100,
    });
    
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith({
      amount: 10000,
      currency: 'usd',
      capture_method: 'manual',
    });
  });
});
```

### Search Indexing
```typescript
// services/search/indexer.ts
export async function indexProfiles() {
  // 1. Poll outbox
  const records = await db.query(
    'SELECT * FROM search.outbox WHERE processed = false LIMIT 100'
  );
  
  // 2. Transform to search documents
  const documents = records.map(transformToSearchDocument);
  
  // 3. Batch upsert to Typesense
  await typesense.collections('models').documents().import(documents, {
    action: 'upsert',
  });
  
  // 4. Mark as processed
  await db.query(
    'UPDATE search.outbox SET processed = true WHERE id = ANY($1)',
    [records.map(r => r.id)]
  );
}
```

## References

- Services: `services/`
- API Schemas: `api/schema/`
- Migrations: `db/migrations/`
- Tests: `tests/`
- ADRs: `docs/adrs/`

## Contacts

- **Primary**: Backend Team
- **Escalation**: Engineering Manager
- **Code Review**: Senior Backend Engineers
