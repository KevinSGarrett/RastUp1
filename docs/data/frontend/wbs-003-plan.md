# WBS-003 Frontend Plan — Search, Profiles, Booking, Messaging

## Context Snapshot
- **Date**: 2025-11-25
- **Agent**: AGENT-3 — Frontend & Developer Experience
- **WBS IDs**: `WBS-003` (depends on `WBS-002`, cross-links `WBS-005`, `WBS-006`, `WBS-017`)
- **Blueprint refs**: `TD-0000` – `TD-0008`, `TD-0019` – `TD-0056`, `TD-0236` – `TD-0249`
- **Scope paths (initial)**:  
  `web/app/{search,u/[handle]/[role],booking/**}` ·  
  `web/components/{Search,Profile,Booking,Layout}/**` ·  
  `web/lib/{search,profiles,booking,telemetry}.mjs` ·  
  `tools/frontend/{search,profiles,booking}/**` ·  
  `tests/frontend/{search,profiles,booking}/**` ·  
  `docs/data/frontend/**` ·  
  `docs/PROGRESS.md` ·  
  `ops/locks/AGENT-3.lock`
- **Assumptions**: GraphQL resolvers for search/profiles/booking are pending; this run delivers Next.js UI + headless stores with stub + contract-driven adapters and telemetry hooks. Messaging workspace from `WBS-006` is reused and extended for unified navigation.

## Plan vs Done vs Pending (pre-implementation)
- **Plan**
  1. Deliver search workspace UI (role + studio tabs, filters, autocomplete, safe-mode gating) with headless store, data source, analytics, and unit tests.
  2. Implement multi-role profile surfaces (profile header, completeness meter, packages/add-ons, Safe-Mode media, SEO JSON-LD) plus accessibility + telemetry instrumentation.
  3. Build booking flow UI (availability calendar, add-ons, pricing breakdown, checkout steps for documents + payment) with state stores, stub data source, and Playwright-ready hooks.
  4. Wire global layout & navigation to unify search, profiles, booking, and messaging with telemetry events, error affordances, and quiet-mode notifications.
  5. Add unit/interaction tests, update documentation, run mandated `make ci`, assemble run report & attach pack.
- **Done**
  - Reviewed blueprint sections (§1.1 – §1.4, §1.20), prior WBS-003/005/006 run reports, and existing frontend/messaging/calendar scaffolds.
  - Acquired lock (`ops/locks/AGENT-3.lock`) and recorded plan context.
  - Implemented search workspace route `/search` plus supporting store, filters, data source, components, and unit coverage with telemetry hooks.
  - Delivered multi-role profile page `/u/[handle]/[role]` with Safe-Mode gallery handling, completeness meter, packages/testimonials, JSON-LD emission, and tests.
  - Shipped booking flow `/booking/[serviceProfileId]` with package selection, availability picker, pricing breakdown, document & payment reviewing, state store, data source, and tests.
  - Added shared telemetry helper, navigation shell, and executed targeted frontend unit suites (search/profile/booking).
- **Pending**
  - None for this run; additional follow-up (e.g., real GraphQL wiring, integration tests) will be tracked in future WBS tasks.

## Approach Notes
- Follow existing pattern (`tools/frontend/*` + `web/lib/*` + Next.js routes) for deterministic stores + React bindings.
- Provide Safe-Mode aware stub datasets mirroring GraphQL schemas so future agents can plug transports without refactoring.
- Ensure accessibility (semantic landmarks, skip links, ARIA on filters, keyboard traps avoided). Target WCAG 2.1/2.2 AA.
- Emit telemetry via a lightweight event bus capturing key interactions (`search:query`, `profile:engagement`, `booking:step_completed`, `messaging:navigation`).
- Record error states using client-safe codes surfaced via toast/banner components to meet blueprint error-handling guardrails.
