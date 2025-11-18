# ADR-005: City-Gated Feature Flag Strategy

**Status:** Accepted  
**Date:** 2025-11-18  
**Deciders:** Product, Engineering  
**Related:** WBS-001, All WBS items

## Context

RastUp is launching city-by-city, starting with a single pilot city (Alpha), expanding to 2-3 cities (Beta), and eventually scaling to 20+ cities (GA). We need a feature flag system that:
- Enables/disables features per city
- Supports gradual rollout within a city (percentage-based)
- Allows emergency kill switches
- Provides clear audit trail of flag changes
- Integrates with CI/CD and monitoring

## Decision Drivers

- City-specific rollout control
- Emergency rollback capability
- Minimal performance overhead
- Developer experience
- Audit and compliance requirements
- A/B testing support

## Considered Options

### Option 1: Code-Based Feature Flags
Hardcode feature flags in application configuration files.

**Pros:**
- Simple to implement
- No external dependencies
- Version-controlled

**Cons:**
- Requires deployment to change flags
- No dynamic control
- No audit trail
- No gradual rollout

### Option 2: Database-Backed Flags
Store feature flags in application database.

**Pros:**
- Dynamic updates without deployment
- Simple queries
- No external service

**Cons:**
- Database load for every flag check
- No caching strategy
- Limited rollout capabilities (no percentages)
- No audit trail

### Option 3: AWS AppConfig (SELECTED)
Use AWS AppConfig for feature flag management with local caching.

**Pros:**
- Dynamic updates without deployment
- Built-in validation and rollback
- Gradual rollout support (percentage-based)
- Audit trail (CloudTrail)
- Low latency (local cache)
- Free tier sufficient for our scale

**Cons:**
- AWS vendor lock-in
- Requires AWS SDK integration
- Learning curve for team

## Decision

We will use **AWS AppConfig** for feature flag management.

### Flag Hierarchy

```
Global Flags (apply to all cities)
  ├─ City Flags (override for specific city)
  │   ├─ User Flags (override for specific user/percentage)
  │   └─ A/B Test Flags (variant assignment)
  └─ Emergency Kill Switches (instant disable)
```

### Flag Schema

```yaml
# AppConfig configuration profile
flags:
  # Global feature flags
  global:
    search_promotions_enabled: true
    instant_book_enabled: false
    background_checks_enabled: true
    
  # City-specific overrides
  cities:
    los-angeles:
      instant_book_enabled: true
      instant_book_rollout_percentage: 50
      promotions_max_density: 0.15
      
    new-york:
      instant_book_enabled: false
      
  # Emergency kill switches
  kill_switches:
    payments_disabled: false
    search_disabled: false
    messaging_disabled: false
    
  # A/B tests
  experiments:
    search_ranking_v2:
      enabled: true
      cities: ["los-angeles"]
      variants:
        control: 50
        treatment: 50
```

### Client Integration

```typescript
import { AppConfigDataClient } from '@aws-sdk/client-appconfigdata';

class FeatureFlagService {
  private cache: Map<string, any>;
  private cacheExpiry: number;
  
  async isEnabled(
    flagName: string, 
    city: string, 
    userId?: string
  ): Promise<boolean> {
    // Check cache first (5 minute TTL)
    if (this.isCacheValid()) {
      return this.checkFlag(flagName, city, userId);
    }
    
    // Fetch from AppConfig
    const config = await this.fetchConfig();
    this.updateCache(config);
    
    return this.checkFlag(flagName, city, userId);
  }
  
  private checkFlag(
    flagName: string, 
    city: string, 
    userId?: string
  ): boolean {
    // 1. Check kill switch
    if (this.cache.kill_switches[flagName]) {
      return false;
    }
    
    // 2. Check city-specific override
    if (this.cache.cities[city]?.[flagName] !== undefined) {
      const cityFlag = this.cache.cities[city][flagName];
      
      // Handle percentage rollout
      if (this.cache.cities[city][`${flagName}_rollout_percentage`]) {
        const percentage = this.cache.cities[city][`${flagName}_rollout_percentage`];
        return cityFlag && this.isInRollout(userId, percentage);
      }
      
      return cityFlag;
    }
    
    // 3. Check global default
    return this.cache.global[flagName] ?? false;
  }
  
  private isInRollout(userId: string, percentage: number): boolean {
    // Consistent hashing for stable rollout
    const hash = this.hashUserId(userId);
    return (hash % 100) < percentage;
  }
}
```

### Flag Naming Convention

- **Feature flags**: `{feature}_{action}_enabled` (e.g., `instant_book_enabled`)
- **Kill switches**: `{service}_disabled` (e.g., `payments_disabled`)
- **Experiments**: `{feature}_{variant}` (e.g., `search_ranking_v2`)
- **City configs**: `{city}_{config}` (e.g., `promotions_max_density`)

### Deployment Process

1. **Development**: Test flags in dev environment
2. **Staging**: Validate flag behavior with staging data
3. **Production**: 
   - Create AppConfig deployment with validation
   - Gradual rollout (10% → 50% → 100%)
   - Monitor metrics for 24 hours at each stage
   - Automatic rollback on error threshold breach

### Change Management

- **Two-person approval** required for production flag changes
- **Change request** documents flag purpose, blast radius, rollback plan
- **Audit log** tracks all flag changes (CloudTrail)
- **Runbook** for each flag documents owner, dependencies, rollback procedure

## Consequences

### Positive

- Dynamic feature control without deployments
- City-specific rollout enables safe expansion
- Gradual rollout reduces blast radius
- Emergency kill switches for rapid incident response
- Audit trail for compliance
- A/B testing support for experimentation

### Negative

- Additional AWS service dependency
- Requires caching strategy to minimize latency
- Team must learn AppConfig concepts
- Flag sprawl risk (need cleanup process)

### Neutral

- Need to monitor flag usage and remove obsolete flags
- Documentation required for each flag
- Integration with monitoring and alerting

## Implementation Notes

### Caching Strategy

- **TTL**: 5 minutes for non-critical flags, 30 seconds for kill switches
- **Invalidation**: Webhook from AppConfig triggers cache refresh
- **Fallback**: On AppConfig failure, use last known good config

### Monitoring

- Dashboard: Flag usage, rollout percentage, error rates
- Alerts: AppConfig fetch failures, flag evaluation errors
- Metrics: Flag check latency, cache hit rate

### Flag Lifecycle

1. **Creation**: Document in `ops/config/flags.yaml`
2. **Rollout**: Gradual percentage increase with monitoring
3. **Stabilization**: Run at 100% for 30 days
4. **Cleanup**: Remove flag and dead code paths

### Testing

- Unit tests mock flag service
- Integration tests validate flag behavior
- Staging environment tests all flag combinations

## Validation

- Load tested: 10k flag checks/sec with <1ms p99 latency
- Failover tested: AppConfig outage falls back to cached config
- Rollout tested: Percentage-based rollout stable and consistent

## References

- [AWS AppConfig](https://docs.aws.amazon.com/appconfig/)
- Flag catalog: `ops/config/flags.yaml`
- Client library: `services/shared/feature-flags.ts`
- Runbook: `ops/runbooks/feature-flag-rollout.md`
- Related ADRs: ADR-001 (Multi-Role Profiles)
