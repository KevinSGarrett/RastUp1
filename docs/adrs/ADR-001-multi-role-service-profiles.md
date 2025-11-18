# ADR-001: Multi-Role Service Profile Design

**Status:** Accepted  
**Date:** 2025-11-18  
**Deciders:** Product, Engineering  
**Related:** NT-0000, WBS-002

## Context

Users in the creative marketplace often fulfill multiple roles (e.g., a person who is both a Model and a Photographer). We need to decide how to represent these multi-role users in our data model and user experience.

## Decision Drivers

- User convenience (single login for multiple roles)
- Search clarity (role-specific discovery)
- Booking simplicity (clear service offerings)
- Data integrity (separate portfolios and reviews per role)
- SEO optimization (role-specific URLs)

## Considered Options

### Option 1: Multiple Accounts
Create separate accounts for each role, requiring users to manage multiple logins.

**Pros:**
- Simple data model
- Clear separation of concerns
- Easy to implement

**Cons:**
- Poor user experience (multiple logins)
- Duplicate user data
- Fragmented reputation and followers

### Option 2: Single Account with Role Flags
Single account with boolean flags for each role, mixing all data together.

**Pros:**
- Single login
- Simple account management

**Cons:**
- Confusing search results (which role is being booked?)
- Mixed portfolios and reviews
- Poor SEO (no role-specific URLs)
- Difficult to manage role-specific fields

### Option 3: Linked Service Profiles (SELECTED)
Single account with multiple "Service Profiles" (one per role), each with its own portfolio, rates, and reviews.

**Pros:**
- Single login with shared identity
- Clear role separation for search and booking
- Role-specific portfolios and reviews
- SEO-friendly URLs (`/u/{handle}/model`, `/u/{handle}/photographer`)
- Shared global assets (followers, inbox, feed)

**Cons:**
- More complex data model
- Additional UI complexity for multi-role users

## Decision

We will implement **Option 3: Linked Service Profiles**.

### Data Model

```typescript
// Account (shared identity)
interface Account {
  id: string;
  handle: string;
  displayName: string;
  avatar: string;
  city: string;
  verificationBadges: string[];
  backgroundCheckBadge: boolean;
  followerCount: number;
  followingCount: number;
}

// Service Profile (one per role)
interface ServiceProfile {
  id: string;
  accountId: string;
  role: 'model' | 'photographer' | 'videographer' | 'creator';
  portfolioItems: MediaItem[];
  rates: RatePackage[];
  availability: Calendar;
  reviews: Review[];
  roleSpecificFields: Record<string, any>;
  searchIndexEntry: SearchDocument;
}
```

### URL Structure

- Account overview: `/u/{handle}`
- Service profiles: `/u/{handle}/model`, `/u/{handle}/photographer`, etc.
- Search results link directly to role-specific pages

### Shared Elements

- Display name, avatar, city, verification badges
- Follower/following counts (global)
- Unified inbox (role-aware threads)
- Unified feed (posts tagged to roles)
- Favorites boards

## Consequences

### Positive

- Excellent user experience for multi-role users
- Clear search and booking context
- SEO-optimized with role-specific URLs
- Flexible role-specific field schemas
- Clean separation of portfolios and reviews

### Negative

- More complex data model requires careful schema design
- UI must handle role switching gracefully
- Search indexing must create separate documents per role
- Analytics must track both account-level and role-level metrics

### Neutral

- Migration path for existing users is straightforward
- Admin tools need role-aware filtering

## Implementation Notes

- Database schema includes `accounts` and `service_profiles` tables with 1:N relationship
- GraphQL schema exposes both `Account` and `ServiceProfile` types
- Search indexer creates separate documents for each service profile
- Frontend uses tabs/chips to switch between roles on profile pages

## References

- Blueprint: NT-0000 (Role System Design)
- WBS: WBS-002 (Core Data Models)
- Related ADRs: ADR-004 (Search Indexing)
