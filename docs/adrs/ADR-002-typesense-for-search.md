# ADR-002: Typesense for Primary Search Engine

**Status:** Accepted  
**Date:** 2025-11-18  
**Deciders:** Engineering, Product  
**Related:** WBS-003

## Context

We need a search engine for service provider discovery that supports:
- Full-text search with typo tolerance
- Faceted filtering (location, rates, categories, etc.)
- Geo-search (city-based results)
- Promotions and boosting
- Sub-100ms query latency
- Cost-effective scaling

## Decision Drivers

- Query performance (p95 < 100ms)
- Relevance tuning flexibility
- Operational simplicity
- Cost at scale
- Developer experience
- Promotion/boost capabilities

## Considered Options

### Option 1: Algolia
Managed search-as-a-service with excellent performance and DX.

**Pros:**
- Best-in-class performance
- Excellent documentation and SDKs
- Managed service (no ops burden)
- Great typo tolerance and relevance

**Cons:**
- Expensive at scale ($1-2 per 1000 searches)
- Limited control over ranking algorithms
- Vendor lock-in
- Promotion features require enterprise tier

### Option 2: Elasticsearch/OpenSearch
Open-source search with rich ecosystem.

**Pros:**
- Mature and battle-tested
- Rich query DSL
- Good AWS integration (OpenSearch Serverless)
- Flexible ranking and scoring

**Cons:**
- Complex to operate and tune
- Higher latency than specialized solutions
- Resource-intensive (high memory requirements)
- Steep learning curve

### Option 3: Typesense (SELECTED)
Open-source, typo-tolerant search engine optimized for speed.

**Pros:**
- Excellent performance (sub-50ms queries)
- Simple API and great DX
- Cost-effective (self-hosted or cloud)
- Built-in typo tolerance and relevance
- Easy to operate (single binary)
- Good promotion/boost support
- Active development and community

**Cons:**
- Smaller ecosystem than Elasticsearch
- Fewer advanced features (no ML ranking)
- Self-hosted requires some operational overhead

## Decision

We will use **Typesense** as our primary search engine, with **OpenSearch** as a hot-standby fallback.

### Architecture

```
Application → Search Service → Typesense (primary)
                            ↓ (fallback)
                          OpenSearch (hot-standby)
```

### Indexing Strategy

- Outbox pattern: Application writes to `search.outbox` table
- Lambda indexer polls outbox and batches updates to Typesense
- Separate collection per role (models, photographers, videographers, creators)
- Nightly full reindex for data consistency

### Fallback Strategy

- Feature flag `search.engine=TYPESENSE|OPENSEARCH`
- Health checks monitor Typesense latency and availability
- Automatic failover if Typesense unhealthy
- OpenSearch kept in sync via same indexing pipeline

## Consequences

### Positive

- Fast queries (p95 < 50ms) improve user experience
- Low operational complexity (single binary, simple config)
- Cost-effective scaling (self-hosted or Typesense Cloud)
- Good developer experience accelerates feature development
- Fallback to OpenSearch provides resilience

### Negative

- Need to maintain two search engines (Typesense + OpenSearch fallback)
- Limited ML-based ranking (must implement custom scoring)
- Smaller community than Elasticsearch (fewer resources)

### Neutral

- Self-hosting requires monitoring and backup procedures
- Promotion logic implemented in application layer

## Implementation Notes

- Typesense deployed on ECS Fargate with persistent EBS volumes
- OpenSearch Serverless for fallback (pay-per-use)
- DynamoDB cache layer for frequently accessed queries (SWR pattern)
- Synonym management via admin console with two-person approval
- Telemetry: `search.*` events track latency, hit rate, and fallback triggers

## Validation

- Load testing: 1000 req/s sustained, p95 < 100ms
- Failover testing: Automatic switch to OpenSearch within 30s
- Cost analysis: $200/month at 10M searches (vs $10k+ for Algolia)

## References

- [Typesense Documentation](https://typesense.org/docs/)
- Blueprint: WBS-003 (Search & Indexing)
- Runbook: `ops/runbooks/search-index.md`
- Related ADRs: ADR-004 (Outbox Pattern)
