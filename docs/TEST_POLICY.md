# Testing Policy

**Version:** 1.0  
**Last Updated:** 2025-11-18  
**Owner:** Engineering Leadership

---

## Overview

This document defines testing standards, practices, and requirements for the RastUp platform. All code must meet these standards before merging to main and deploying to production.

## Testing Principles

1. **Test Early, Test Often**: Write tests alongside code, not after
2. **Shift Left**: Catch bugs in development, not production
3. **Test Pyramid**: More unit tests, fewer E2E tests
4. **Fast Feedback**: Tests should run quickly in CI
5. **Reliable Tests**: No flaky tests tolerated
6. **Test in Production**: Monitor and validate in real environment

## Test Types and Requirements

### 1. Unit Tests

**Purpose**: Test individual functions and components in isolation

**Requirements**:
- **Coverage**: Minimum 80% code coverage
- **Speed**: < 10ms per test
- **Isolation**: No external dependencies (mock all I/O)
- **Deterministic**: Same input always produces same output

**When Required**:
- All business logic functions
- All utility functions
- All data transformations
- All validation logic

**Example**:
```typescript
// services/booking/calculateFee.test.ts
describe('calculateFee', () => {
  it('should calculate 10% platform fee', () => {
    const fee = calculateFee(100);
    expect(fee).toBe(10);
  });

  it('should handle zero amount', () => {
    const fee = calculateFee(0);
    expect(fee).toBe(0);
  });

  it('should round to 2 decimal places', () => {
    const fee = calculateFee(33.33);
    expect(fee).toBe(3.33);
  });
});
```

**Tools**: Jest, Vitest

### 2. Integration Tests

**Purpose**: Test interactions between components and external services

**Requirements**:
- **Coverage**: All critical integrations tested
- **Speed**: < 1s per test
- **Isolation**: Use test database, mock external APIs
- **Cleanup**: Reset state after each test

**When Required**:
- Database operations (CRUD)
- API endpoints (GraphQL, REST)
- Message queue operations
- Cache operations
- External service integrations (with mocks)

**Example**:
```typescript
// services/booking/booking.integration.test.ts
describe('Booking API', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('should create booking and charge payment', async () => {
    const stripeMock = mockStripe();
    
    const booking = await createBooking({
      clientId: 'user-123',
      providerId: 'provider-456',
      amount: 100,
    });

    expect(booking.id).toBeDefined();
    expect(booking.status).toBe('pending');
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith({
      amount: 10000,
      currency: 'usd',
      capture_method: 'manual',
    });
  });
});
```

**Tools**: Jest, Supertest, Testcontainers

### 3. End-to-End (E2E) Tests

**Purpose**: Test complete user flows from UI to database

**Requirements**:
- **Coverage**: All critical user journeys
- **Speed**: < 30s per test
- **Environment**: Staging environment
- **Data**: Use test accounts, clean up after

**When Required**:
- User registration and login
- Search and booking flow
- Payment processing
- Messaging
- Profile management

**Example**:
```typescript
// tests/e2e/booking-flow.test.ts
describe('Booking Flow', () => {
  it('should complete full booking flow', async () => {
    // 1. Login as client
    await page.goto('https://staging.rastup.com/login');
    await page.fill('[name=email]', 'test-client@example.com');
    await page.fill('[name=password]', 'password123');
    await page.click('button[type=submit]');

    // 2. Search for photographer
    await page.goto('https://staging.rastup.com/search?role=photographer');
    await page.click('.search-result:first-child');

    // 3. Book photographer
    await page.click('button:has-text("Book Now")');
    await page.fill('[name=date]', '2025-12-01');
    await page.fill('[name=duration]', '2');
    await page.click('button:has-text("Continue")');

    // 4. Complete payment
    await page.fill('[name=cardNumber]', '4242424242424242');
    await page.fill('[name=expiry]', '12/25');
    await page.fill('[name=cvc]', '123');
    await page.click('button:has-text("Confirm Booking")');

    // 5. Verify booking created
    await expect(page.locator('.booking-confirmation')).toBeVisible();
    const bookingId = await page.locator('.booking-id').textContent();
    expect(bookingId).toMatch(/^BK-/);
  });
});
```

**Tools**: Playwright, Cypress

### 4. Contract Tests

**Purpose**: Verify API contracts between services

**Requirements**:
- **Coverage**: All public APIs
- **Speed**: < 5s per test
- **Versioning**: Test backward compatibility

**When Required**:
- GraphQL schema changes
- REST API changes
- Message queue payload changes
- Webhook payload changes

**Example**:
```typescript
// api/schema/booking.contract.test.ts
describe('Booking API Contract', () => {
  it('should match GraphQL schema', async () => {
    const schema = await loadGraphQLSchema();
    const query = `
      query GetBooking($id: ID!) {
        booking(id: $id) {
          id
          status
          amount
          client { id, name }
          provider { id, name }
        }
      }
    `;
    
    const errors = validateQuery(schema, query);
    expect(errors).toHaveLength(0);
  });

  it('should return expected response shape', async () => {
    const response = await graphql({
      schema,
      source: query,
      variableValues: { id: 'test-booking-id' },
    });

    expect(response.data).toMatchObject({
      booking: {
        id: expect.any(String),
        status: expect.stringMatching(/^(pending|accepted|completed|cancelled)$/),
        amount: expect.any(Number),
        client: { id: expect.any(String), name: expect.any(String) },
        provider: { id: expect.any(String), name: expect.any(String) },
      },
    });
  });
});
```

**Tools**: Pact, GraphQL Inspector

### 5. Performance Tests

**Purpose**: Verify system performance under load

**Requirements**:
- **Load**: Test at 2x expected peak load
- **Duration**: Sustain for 10 minutes minimum
- **Metrics**: Latency (p50, p95, p99), throughput, error rate

**When Required**:
- Before major releases
- After performance-critical changes
- Quarterly baseline tests

**Example**:
```javascript
// tests/performance/api-load.test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up
    { duration: '5m', target: 100 },  // Sustain
    { duration: '2m', target: 200 },  // Spike
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed: ['rate<0.01'],    // Error rate < 1%
  },
};

export default function () {
  const res = http.get('https://staging.rastup.com/api/search?role=model&city=los-angeles');
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  sleep(1);
}
```

**Tools**: k6, Artillery, JMeter

### 6. Security Tests

**Purpose**: Identify security vulnerabilities

**Requirements**:
- **Frequency**: Every PR (SAST), weekly (DAST), quarterly (pen test)
- **Coverage**: All code, dependencies, infrastructure

**When Required**:
- All PRs (automated SAST)
- Before releases (DAST)
- Quarterly (manual pen test)

**Tests**:
- Static analysis (SAST): Semgrep, Snyk
- Dynamic analysis (DAST): OWASP ZAP
- Dependency scanning: npm audit, Snyk
- Secret scanning: GitGuardian, TruffleHog
- Container scanning: Trivy, Grype

**Example**:
```bash
# Run security tests
npm run test:security

# SAST
semgrep --config=auto .

# Dependency scan
npm audit --audit-level=moderate

# Secret scan
trufflehog git file://. --only-verified

# Container scan (if applicable)
trivy image rastup/api:latest
```

**Tools**: Semgrep, Snyk, OWASP ZAP, TruffleHog

### 7. Smoke Tests

**Purpose**: Verify critical functionality after deployment

**Requirements**:
- **Speed**: < 2 minutes total
- **Coverage**: Critical user paths only
- **Environment**: Run in production after deploy

**When Required**:
- After every production deployment
- After infrastructure changes
- After feature flag changes

**Example**:
```typescript
// tests/smoke/critical-paths.test.ts
describe('Smoke Tests', () => {
  it('should load homepage', async () => {
    const res = await fetch('https://rastup.com');
    expect(res.status).toBe(200);
  });

  it('should perform search', async () => {
    const res = await fetch('https://api.rastup.com/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: '{ search(role: "model", city: "los-angeles") { results { id } } }',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.errors).toBeUndefined();
  });

  it('should process health check', async () => {
    const res = await fetch('https://api.rastup.com/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('healthy');
  });
});
```

**Tools**: Jest, Playwright

## Test Coverage Requirements

### Minimum Coverage Targets

| Code Type | Unit Test Coverage | Integration Test Coverage |
|-----------|-------------------|---------------------------|
| Business Logic | 90% | 80% |
| API Endpoints | 70% | 100% |
| Utilities | 80% | N/A |
| UI Components | 70% | 50% |
| Overall | 80% | 70% |

### Coverage Enforcement

```bash
# Run tests with coverage
npm test -- --coverage

# Enforce coverage thresholds
jest --coverage --coverageThreshold='{
  "global": {
    "branches": 80,
    "functions": 80,
    "lines": 80,
    "statements": 80
  }
}'

# CI fails if coverage below threshold
```

## Test Data Management

### Test Databases

- **Unit Tests**: In-memory SQLite or mocks
- **Integration Tests**: Testcontainers (PostgreSQL)
- **E2E Tests**: Staging database (cleaned after each run)

### Test Accounts

- **Staging**: Dedicated test accounts (test-*@example.com)
- **Production**: No test accounts (use staging)

### Data Cleanup

```typescript
// Clean up test data after each test
afterEach(async () => {
  await db.query('DELETE FROM bookings WHERE client_id LIKE "test-%"');
  await db.query('DELETE FROM users WHERE email LIKE "test-%@example.com"');
  await cache.flushAll();
});
```

## CI/CD Integration

### Pre-Commit Hooks

```bash
# .husky/pre-commit
npm run lint
npm run test:unit -- --bail --findRelatedTests
```

### Pull Request Checks

Required checks before merge:
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Code coverage ≥ 80%
- [ ] No linting errors
- [ ] Security scan passes
- [ ] Contract tests pass (if API changed)

### Deployment Pipeline

```yaml
# .github/workflows/deploy.yml
- name: Run Tests
  run: |
    npm run test:unit
    npm run test:integration
    npm run test:security
    
- name: Check Coverage
  run: npm run test:coverage -- --threshold=80

- name: Deploy to Staging
  run: npm run deploy:staging

- name: Run E2E Tests
  run: npm run test:e2e -- --env=staging

- name: Deploy to Production
  run: npm run deploy:production

- name: Run Smoke Tests
  run: npm run test:smoke -- --env=production
```

## Test Maintenance

### Flaky Tests

**Zero Tolerance Policy**: Flaky tests must be fixed or disabled immediately.

**Common Causes**:
- Race conditions (async timing)
- External dependencies
- Shared state between tests
- Non-deterministic data

**Resolution**:
```typescript
// Bad: Flaky due to timing
it('should update status', async () => {
  updateStatus('pending');
  await wait(100);  // Flaky: might not be enough time
  expect(getStatus()).toBe('pending');
});

// Good: Wait for condition
it('should update status', async () => {
  updateStatus('pending');
  await waitFor(() => getStatus() === 'pending', { timeout: 5000 });
  expect(getStatus()).toBe('pending');
});
```

### Test Quarantine

If test is flaky and fix is not immediate:

```typescript
// Quarantine flaky test
it.skip('should complete booking flow', async () => {
  // TODO: Fix flaky test (ticket: TEST-123)
  // Flaky due to: Stripe webhook timing
  // ...
});
```

### Test Debt

- **Monthly Review**: Review skipped/quarantined tests
- **Quarterly Cleanup**: Remove obsolete tests
- **Annual Audit**: Review test strategy and coverage

## Monitoring and Observability

### Test Metrics

Track in CI/CD:
- Test execution time
- Test failure rate
- Code coverage trend
- Flaky test count

### Production Monitoring

Tests don't end at deployment:
- Synthetic monitoring (Datadog, Pingdom)
- Real user monitoring (RUM)
- Error tracking (Sentry)
- Performance monitoring (APM)

## Exceptions and Waivers

### When Tests Can Be Skipped

- **Prototype/POC**: Clearly marked, never merged to main
- **Emergency Hotfix**: Must add tests in follow-up PR within 24 hours
- **Legacy Code**: Gradual improvement plan required

### Waiver Process

1. Create waiver request (ticket)
2. Document reason and risk
3. Get approval from Engineering Manager
4. Set deadline for compliance
5. Track in test debt backlog

## References

- Test Examples: `tests/`
- CI Configuration: `.github/workflows/`
- Coverage Reports: https://codecov.io/rastup/platform
- Test Dashboard: https://dashboard.rastup.com/tests

## Contacts

- **Testing Lead**: @test-lead (Slack)
- **QA Team**: @qa-team (Slack)
- **Engineering Manager**: @eng-manager (Slack)

---

**Review Cadence**: Quarterly or after major changes
