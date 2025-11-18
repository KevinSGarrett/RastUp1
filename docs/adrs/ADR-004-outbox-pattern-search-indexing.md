# ADR-004: Outbox Pattern for Search Indexing

**Status:** Accepted  
**Date:** 2025-11-18  
**Deciders:** Engineering  
**Related:** WBS-003

## Context

We need to keep the search index (Typesense/OpenSearch) in sync with the primary database (Aurora PostgreSQL) while ensuring:
- Eventual consistency
- No data loss
- Resilience to search engine outages
- Ability to reindex from source of truth
- Clear audit trail of index operations

## Decision Drivers

- Data consistency (no missed updates)
- Resilience (search outage doesn't block app)
- Debuggability (track what was indexed and when)
- Reindexing capability (recover from index corruption)
- Performance (minimal impact on write path)

## Considered Options

### Option 1: Direct Indexing
Application writes to database and search index synchronously.

**Pros:**
- Simple to implement
- Immediate consistency

**Cons:**
- Search outage blocks application writes
- No retry mechanism for failed indexes
- Difficult to debug indexing issues
- No reindexing capability

### Option 2: Change Data Capture (CDC)
Use database CDC (e.g., Debezium) to stream changes to search index.

**Pros:**
- Automatic change detection
- No application code changes
- Guaranteed delivery

**Cons:**
- Complex infrastructure (Kafka, connectors)
- Difficult to filter/transform events
- Hard to debug and replay
- Operational overhead

### Option 3: Outbox Pattern (SELECTED)
Application writes to database and outbox table in same transaction, separate process indexes from outbox.

**Pros:**
- Transactional consistency (atomic write to DB + outbox)
- Resilient to search outages (outbox persists)
- Easy to retry failed indexes
- Simple reindexing (replay outbox or full scan)
- Clear audit trail
- Easy to debug (inspect outbox records)

**Cons:**
- Eventual consistency (slight delay)
- Additional table and indexing process
- Need to manage outbox cleanup

## Decision

We will use the **Outbox Pattern** for search indexing.

### Architecture

```
Application Write:
  BEGIN TRANSACTION
    UPDATE profiles SET ...
    INSERT INTO search.outbox (entity_type, entity_id, operation, payload)
  COMMIT

Indexer Process (Lambda):
  1. Poll search.outbox WHERE processed = false
  2. Batch by entity_type (models, photographers, etc.)
  3. Transform to search documents
  4. Upsert to Typesense
  5. Mark outbox records as processed
  6. On error: increment retry_count, log to DLQ
```

### Database Schema

```sql
CREATE SCHEMA search;

CREATE TABLE search.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL, -- 'model', 'photographer', etc.
  entity_id UUID NOT NULL,
  operation TEXT NOT NULL, -- 'upsert' or 'delete'
  payload JSONB NOT NULL, -- normalized search document
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMP,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_outbox_processing ON search.outbox (processed, created_at)
  WHERE processed = false;

CREATE TABLE search.outbox_dlq (
  id UUID PRIMARY KEY,
  outbox_record JSONB NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Indexer Lambda

- **Trigger**: CloudWatch Events (every 1 minute)
- **Batch Size**: 100 records per invocation
- **Timeout**: 5 minutes
- **Concurrency**: 5 (to handle backlog)
- **Dead Letter Queue**: Failed records moved to `outbox_dlq` after 3 retries

### Normalization

Application writes normalized search documents to outbox:

```typescript
interface SearchDocument {
  id: string;
  role: 'model' | 'photographer' | 'videographer' | 'creator';
  handle: string;
  displayName: string;
  city: string;
  categories: string[];
  rateMin: number;
  rateMax: number;
  rating: number;
  reviewCount: number;
  verificationBadges: string[];
  portfolioImageUrls: string[];
  // role-specific fields...
}
```

### Reindexing

Two reindexing strategies:

1. **Incremental**: Replay outbox from specific timestamp
   ```sql
   UPDATE search.outbox 
   SET processed = false 
   WHERE created_at >= :start_time;
   ```

2. **Full**: Scan database and rebuild index
   - Pause indexer Lambda
   - Truncate Typesense collection
   - Stream all profiles from database
   - Batch upsert to Typesense
   - Resume indexer Lambda

## Consequences

### Positive

- Application writes never blocked by search outages
- Clear audit trail of all index operations
- Easy to debug and replay failed indexes
- Simple reindexing from source of truth
- Transactional consistency (DB + outbox atomic)

### Negative

- Eventual consistency (1-2 minute delay)
- Additional storage for outbox table
- Need to manage outbox cleanup (purge old records)

### Neutral

- Indexer Lambda adds operational component
- Monitoring required for outbox backlog

## Implementation Notes

### Outbox Cleanup

- Retain processed records for 7 days (debugging)
- Daily job purges records older than 7 days
- DLQ records retained for 30 days

### Monitoring

- Alert if outbox backlog > 300 records
- Alert if DLQ has new records
- Dashboard: outbox lag, processing rate, error rate

### Promotion Integrity

- Promotions tracked separately in outbox
- Density caps enforced during indexing
- Audit log for promotion changes

## Validation

- Tested with 10k writes/sec (outbox handles load)
- Simulated Typesense outage (outbox accumulates, resumes on recovery)
- Reindexing tested (full rebuild in 15 minutes for 100k profiles)

## References

- [Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- Migration: `db/migrations/025_search_outbox.sql`
- Indexer: `services/search/indexer.ts`
- Runbook: `ops/runbooks/search-index.md`
- Related ADRs: ADR-002 (Typesense)
