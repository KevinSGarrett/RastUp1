# Messaging & Collaboration Frontend Implementation Plan

## Context Snapshot

- **WBS**: `WBS-006` (Messaging & Collaboration System)  
- **Blueprint refs**: `TD-0019` – `TD-0056` (messaging canon, action cards, moderation, comms)  
- **Dependencies**: `WBS-002` (platform data), `WBS-005` (booking core) for leg/LBG context, action card domain flows, and deliverable manifests.  
- **Role**: AGENT-3 — Frontend & Developer Experience.  
- **Current state**: No web application scaffold exists; we rely on headless policy modules under `tools/frontend/**` and Node unit tests. GraphQL APIs and realtime infrastructure are being defined by backend agents (WP‑MSG‑01/02, WP‑ACT‑01/02).  
- **Assumptions**: Booking GraphQL schema (`api/schema/booking.graphql`) will expose thread, message, action card, and project panel types as specified; AppSync subscriptions deliver realtime events filtered by `threadId`. Event naming follows §1.4.K.

## Plan vs Done vs Pending (Pre-implementation)

- **Plan**: Deliver messaging frontend documentation (implementation, UI flows, test strategy) and headless state/policy modules with accompanying unit tests; capture results in run report and attach pack.  
- **Done**: Context ingestion, prior run analysis, lock acquisition.  
- **Pending**: Draft modules/tests, execute suites, document outcomes, prepare orchestrator artifacts.

## Run Scope (2025‑11‑19)

**In scope**
- Document inbox/thread/project panel architecture, state lifecycles, and safety constraints mapped to blueprint canon.
- Define frontend data models, normalization rules, and optimistic update contracts for inquiry & project threads.
- Provide developer experience guidelines (module boundaries, data fetching hooks, event ingestion) to bootstrap the eventual Next.js implementation.
- Prepare headless utilities for upcoming coding steps (rate limits, message request gating, Safe-Mode rendering, action card orchestration) — implemented separately under `tools/frontend/messaging/**`.

**Out of scope (future runs)**
- Building concrete React/Next.js components or wiring actual AppSync GraphQL calls.
- Implementing realtime transport, upload widgets, or UI theming.
- Admin consoles (Support/T&S/Finance) and full notification center UI.

## Architectural Overview

### Surfaces
1. **Inbox (Threads list)**
   - Fetches paginated threads keyed by `participantId`.
   - Displays unread counts, pinned/archived folders, muting status, last message snippet, and Safe-Mode indicators.
   - Supports filters (role, city, booking status) and search by participant or booking metadata.
2. **Thread Viewer**
   - Timeline combining messages, action cards, system notices, and presence events with chronological ordering + day dividers.
   - Composer enforces rate limits, Safe-Mode, credit gating, and anticircumvention nudges.
   - Side rail toggles project panel tabs.
3. **Project Panel Tabs**
   - Brief, Moodboard, Shot list, Files, Docs, Expenses, Actions — each tab surfaces optimistic updates with eventual consistency to Aurora (§1.3).
   - Tabs show optimistic state (local draft) with conflict banners when server version differs.
4. **Notification surface**
   - Toasts and banner stack for incoming events, quiet-hour digests, and moderation decisions.

### Data Flow
- **Initial data**: `inbox` and `thread` GraphQL queries align with schema from §1.4.C (Query.inbox, Query.thread, Query.messages, Query.projectPanel).
- **Realtime**: `threadEvents(threadId)` subscription streams `message`, `action`, `presence` payloads; `inboxEvents` updates thread ordering/unread counts.
- **Normalization**: Clients store threads keyed by `threadId`, participants keyed by `userId`, and messages keyed by `messageId` with stable ordering on `createdAt`.
- **Optimistic writes**: Compose helper ensures temp IDs with prefix `temp_` replaced on ack. Conflict detection uses `version` for action cards and `updatedAt` for tabs.
- **Side effects**: Local analytics/telemetry emit events mirroring §1.4.K for UX instrumentation.
- **Client orchestration**: `createMessagingClient` (tools/frontend/messaging/client.mjs) hydrates the controller from GraphQL queries, manages AppSync subscriptions, and coordinates optimistic mutations with retry/resync safeguards.

### State & Caching Strategy
- Plan to leverage **React Query** (or Apollo) with suspense-friendly caches; headless utilities expose deterministic reducers to manage state outside of any framework.
- `InboxStore`: maintains ordered thread IDs, unread totals, pinned set, and folder filters. Exposes pure functions for `applyInboxEvent`, `toggleMute`, `archiveThread`, `applyRateLimit`.
- `ThreadStore`: handles message timeline, read receipts, typing indicators, optimistic message queue, action card state machines, and project panel snapshots.
- **Presence**: ephemeral state stored separately with TTL; UI uses fallback offline after 60s without ping.
- **Safe-Mode**: top-level context derived from session (verified adult, city gates) and thread metadata (safeModeRequired). Rendering helpers decide render/blur/hide.

### Integrations & Interfaces
- **GraphQL Contracts**
  - `InboxThread`: fields `threadId`, `kind`, `participants`, `lastMessageAt`, `lastMessagePreview`, `unreadCount`, `muted`, `pinned`, `archived`.
  - `Thread`: includes `projectPanel`, `messages.edges.node`, `presence`.
  - `ActionCard`: strictly typed union of card payloads; version increments on state change.
  - `MessageRequest`: new structure gating cross-role contact (pending accept/decline/block).
- **Mutation flows**
  - `sendMessage`, `acceptMessageRequest`, `declineMessageRequest`, `blockThread`, `pinThread`, `archiveThread`, `markInboxRead`.
  - Action card operations mirror §1.4.C mutations with idempotent client id support.
- **Upload pipeline**
  - Use pre-signed URLs with progress callbacks; on completion poll `message.assetStatus` for `SCANNING`, `READY`, `QUARANTINED`.
- **Notifications**
  - local queue holds toasts; quiet-hour info accessible via global preferences context (tie-in to §1.10).

## Safety, Moderation & Guardrails
- **Anticircumvention**: text typed into composer runs through `tools/frontend/messaging/policy.mjs` (to be delivered) returning severity (`ALLOW`, `NUDGE`, `BLOCK`). UI surfaces inline banner; repeated violation escalates to block by mutation.
- **Safe-Mode Rendering**: attachments produce filtered preview object (`displayState: visible|blurred|blocked`) based on thread `safeModeBandMax`, user clearance, and server-supplied `nsfwBand`.
- **Message Requests & Credits**: new contacts initiated from discovery consume `credits`. Helper will enforce rate limit (N per 24h) and check remaining credits before enabling send.
- **Audit surfaces**: All moderation actions triggered via UI capture reason text; utilities log payload to audit stream (persisted by backend).

## Developer Experience Guidelines
- Package headless logic under `tools/frontend/messaging/` (pure functions, deterministic reducers, serializable state).  
- Introduce `createMessagingController` (framework-neutral orchestrator) to combine inbox/thread/notification stores with subscription hooks for React/Next.js contexts; surface helpers for optimistic send, action cards, message requests, and quiet-hour notifications.  
- Layer `createMessagingClient` on top of the controller to wrap GraphQL fetch/mutation/subscribe plumbing, applying `normalize*` helpers, bridging optimistic sends, and auto-refreshing inbox/thread state on transport failures.  
- Ship `createMessagingReactBindings` (tools/frontend/messaging/react_bindings.mjs) to generate React contexts/hooks (`MessagingProvider`, `useInboxThreads`, `useThread`, etc.) while keeping the underlying controller/client framework-neutral; the Next.js façade lives under `web/components/MessagingProvider/**`.  
- `selectThreads` / `controller.selectInboxThreads` now accept advanced filters (`onlyUnread`, `kinds`, `muted`, `safeModeRequired`, `query`, `queryMatcher`) aligning inbox UX with blueprint requirements and enabling custom search matching per surface.  
  - `createMessagingDataSource` exposes fetch helpers plus configurable `mutations`/`subscribe*` hooks with Safe-Mode aware stub fallbacks; pass `graphqlMutations`, `mutations`, or `subscribeInbox/subscribeThread` overrides to integrate AppSync/App Server transports without rewriting the workspace client.  
- Upload helpers (`controller.registerUpload`, `client.prepareUpload`, `useUploads`, `prepareUpload`/`cancelUpload` actions) expose a frontend-facing pipeline for file attachments with Safe-Mode aware status tracking prior to backend transport wiring.  
- Action card presenters (`presentActionCard`, `formatActionCardIntentLabel` in `tools/frontend/messaging/action_card_presenter.mjs`) convert raw payloads into UI-friendly descriptors so workspace surfaces can render type-specific summaries without duplicating JSON parsing logic.  
- Provide TypeScript declaration files (`.d.ts`) once the Next.js scaffold materialises; for now, JSDoc shapes near functions for editor IntelliSense.  
- Aim for idempotent helpers to ease unit testing in Node; mirror these in future React hooks (e.g., `useThreadState` delegates to `ThreadStore` reducers).  
- Document event payload shapes and integration steps in `ui_flows.md` and `test_plan.md` for continuity across agents.  
- Logging: instrument `debug` channel `messaging:*` behind environment flag for developer diagnostics without leaking PII.
- Ship GraphQL normalizers (`tools/frontend/messaging/normalizers.mjs`) that translate AppSync query/subscription payloads into inbox/thread/controller inputs, including helpers for controller hydration.

## Component Scaffolding — 2025-11-19
- Added UI timeline helpers (`tools/frontend/messaging/ui_helpers.mjs`) with unit coverage for Safe-Mode redaction, presence summarisation, and relative timestamp formatting.  
- Implemented messaging inbox, thread, composer, and project panel scaffolds under `web/components/Messaging/**`, wired to the provider/hooks surface for hydration, subscriptions, optimistic sends, and action card intents.  
- Inbox UI surfaces pinned/default/archived folders, message request handling (accept/decline/block), credit/rate-limit affordances, and configurable thread labelling hooks for downstream apps.  
- Inbox filter/search bar layers unread/project/inquiry toggles, safe-mode gating, muted cycle states, and free-text search against thread metadata via enhanced `selectThreads` options; behaviour covered by updated inbox/controller unit suites.  
- Thread timeline groups messages by day with Safe-Mode aware rendering, optimistic delivery statuses, attachment state pills, action card panels (controller-driven transitions), and a policy-aware composer showing nudges vs hard blocks.  
- Workspace action card panel now consumes `presentActionCard` outputs to surface schedule changes, extras, deliverables, deposits, and disputes with contextual metadata, evidence attachments, and friendly intent labels instead of raw JSON dumps.  
- Composer integrates file attachments via the upload manager pipeline, surfacing Safe-Mode aware preview/status chips and gating send until scans complete.  
- Project panel tabs render snapshot JSON/structured summaries for `brief`, `moodboard`, `files`, `docs`, `expenses`, and `actions`, ready for future design system styling.
- Introduced Next.js integration utilities (`tools/frontend/messaging/next_adapter.mjs`) providing server-side prefetch + hydration helpers, and packaged a `MessagingWorkspace` layout component (`web/components/Messaging/MessagingWorkspace.tsx`) that composes provider, inbox, thread, and project panel surfaces for immediate route scaffolding.
- Added query persistence helpers (`tools/frontend/messaging/filter_params.mjs` + unit tests) alongside `MessagingWorkspaceRouteBridge` to sync inbox filters, search, and active thread selection with Next.js query parameters.
- Created a server/client handoff for the messaging workspace routed through `web/app/messaging/page.tsx`, using `createMessagingNextAdapter` with a shared data source (`web/lib/messaging/dataSources.mjs`) and a client bridge component (`MessagingWorkspaceClient.tsx`) to hydrate `MessagingProvider` from prefetch snapshots while falling back to Safe-Mode aware stub payloads when GraphQL is not yet wired.
  - Enabled runtime mutations/subscriptions for the workspace by extending `web/lib/messaging/dataSources.mjs` with GraphQL-aware send/read/request helpers plus stub fallbacks, and wiring the new hooks into `MessagingWorkspaceClient.tsx` so messaging actions function even before the backend is live.

## Performance & Offline
- Inbox virtualization and timeline windowing: plan to leverage intersection observers + incremental fetch (`cursor` pagination).  
- Local storage caches last-opened thread (non-sensitive metadata only) for cold-start speed; messages remain in memory due to PII.  
- Ensure message composer debounces typing events (>400 ms) and limits presence pings to <1 request per 5 seconds.  
- Precompute derived counts (open action cards, expenses total) client-side for snappy UI while awaiting backend responses.

## Open Risks & Mitigations
1. **Realtime divergence**: Without backend transport yet, headless reducers must handle out-of-order events. Mitigate with `version` guards and idempotent merges.  
2. **Action card complexity**: Frontend must reflect states from bookings/reservations; ensure domain-specific messages remain in sync by subscribing to `action.state_change`.  
3. **Uploads & Safe-Mode**: Need consistent placeholder states while antivirus results pending; placeholders should consider accessiblity (alt text).  
4. **Performance**: Large threads risk expensive re-renders. Plan to chunk messages (e.g., 50 per page) and rely on virtualization; design reducers to operate incrementally.

## Next Steps (Future Runs)
- Scaffold Next.js app with shared design system and integrate messaging stores into actual pages.  
- Implement GraphQL hooks, websockets (AppSync) subscription wiring, and optimistic mutation wrappers.  
- Build Playwright E2E flows covering inquiry creation, accept/decline, project panel updates, Safe-Mode toggles, and credit gating.  
- Integrate notifications preference UI (§1.10) and admin consoles once backend endpoints exist.  
- Expand observability instrumentation (OpenTelemetry spans, Redux devtools integration) to trace message load/perf budgets.
