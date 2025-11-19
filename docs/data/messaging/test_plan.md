# Messaging Frontend Test Plan

## Objectives
- Verify messaging state utilities enforce blueprint requirements: Safe-Mode, credit gating, action cards, moderation flows, and concurrency.
- Provide guidance for future UI, E2E, and accessibility automation once the Next.js app exists.
- Ensure integration points with booking (§1.3) and notifications (§1.10) are covered with contract tests or mocks.

## Scope
- **In scope now**: Node unit tests for headless reducers/helpers, schema validation of event payload shapes, and snapshot/golden outputs for Safe-Mode rendering logic.
- **Deferred**: React component tests, Playwright E2E, accessibility scans, localization coverage (dependent on UI scaffold).

## Test Categories & Coverage

### 1. Unit Tests (Node — `node --test`)

| Area | Test Focus | Notes |
| --- | --- | --- |
| Inbox store | Ordering, pin/archive/mute toggles, unread counts, rate limit enforcement, advanced filters/search | Simulate `inboxEvents` (new thread, archive, mute), exercise `selectThreads` filters (`onlyUnread`, `kinds`, `muted`, `safeModeRequired`, query + custom matcher), and ensure deterministic ordering. |
| Thread store | Message insertion ordering, optimistic send lifecycle, read receipt updates, presence TTL pruning | Include out-of-order events and idempotency by `messageId`/`version`. |
| Safe-Mode rendering | Attachment display state transitions across `nsfwBand`, overrides, and quarantine | Use matrix of user clearance vs thread requirements. |
| Message requests | Credit gating, expiry, accept/decline transitions | Validate follow-up state (thread moves folder, credits updated). |
| Action cards | State machine transitions for reschedule, extras, deliverables, disputes | Ensure invalid transitions throw `ACTION_INVALID_STATE` and audit payloads generated. |
| Action card presenter | Format summaries, metadata, evidence, and intent labels per card type | `tests/frontend/messaging/action_card_presenter.test.mjs` verifies schedule, extras, deposit, and dispute cards render friendly descriptors. |
| Upload manager | Client-side lifecycle (request → signed → upload → scanning → ready), failure recovery, TTL pruning | Mock server updates for antivirus results, verify attachment linking and metadata retention. |
| Notification queue | Quiet hour deferral, severity bypass, dedupe window, digest summaries | Test release after quiet hours and aggregated digest output for deferred items. |
| Messaging controller | Combined inbox/thread/notification orchestration, optimistic lifecycle, subscription events | Unit tests validating unread sync, optimistic send resolution, message request acceptance, filter-aware `selectInboxThreads`, action card analytics, and digest releases. |
| Messaging client | GraphQL hydration/subscription bridge, optimistic mutation handshake, request mutations, upload pipeline | Unit tests verifying `createMessagingClient` refreshes inbox, hydrates threads, applies mapped events, resolves/flags optimistic sends, invokes request mutations with re-sync on failure, and orchestrates `prepareUpload`/`cancelUpload` lifecycles. |
| React bindings | `MessagingProvider` lifecycle, hook subscriptions, store updates via controller events | Use a lightweight React shim to assert auto-subscribe/cleanup behaviour and that `useInboxThreads`, `useThread`, `useInboxSummary` reflect controller changes. |
| Next.js adapter | Server prefetch + hydration helpers, provider prop wiring | Unit tests cover `createMessagingNextAdapter.prefetch`, `createProviderProps`, and `createRuntime` to ensure inbox/thread payloads hydrate correctly and runtime clients reuse fetch/mutation hooks. |
| Workspace data sources | GraphQL execution vs Safe-Mode stub fallback for inbox/thread hydrators, mutations, subscriptions, and uploads | `tests/frontend/messaging/dataSources.test.mjs` verifies shared data source helpers honour provided fetch implementations, propagate query variables, emit GraphQL mutations (send/read/request), surface stub fallbacks, expose no-op subscription defaults, and return stub upload session/status data until AppSync wiring is ready. |
| Filter params & routing bridge | Query encode/decode for filters/search/thread state; route sync helpers | `filter_params.test.mjs` exercises parse/apply semantics and equality guards; `MessagingWorkspaceRouteBridge` manually verified via story wiring, pending React integration tests once Next.js pages exist. |
| UI helpers | Timeline grouping, Safe-Mode redaction, presence summary, relative timestamps | `tests/frontend/messaging/ui_helpers.test.mjs` covers grouping, attachment display states, and presence status labelling. |
| GraphQL normalizers | `normalizeInboxPayload`, `normalizeThreadPayload`, subscription envelope mappers | Ensure AppSync query/subscription payloads produce stable inbox/thread/controller updates and reject malformed data. |
| Moderation policy | Text evaluation returning `ALLOW`/`NUDGE`/`BLOCK` with escalation counters | Validate threshold resets after cooldown. |

### 2. Integration Tests (Future, Node/React)
- Contract tests running against mocked GraphQL responses to ensure normalization matches schema naming.
- Upload pipeline simulation (mock signed URL, antivirus status) verifying UI placeholders change as expected.
- Notification queue dedupe & quiet-hours deferral.

### 3. E2E / UI Automation (Future)
- **Playwright** flows:
  - Start inquiry, accept message request, send Safe-Mode-compliant message, transition to project thread.
  - Run reschedule workflow (seller propose, buyer accept) and verify action card + booking timeline update.
  - Upload proof -> wait for scanning -> request revisions.
  - Moderation scenario: anti-circumvention triggered, user sees nudge then block.
- **Accessibility**: Axe-core + keyboard navigation for inbox, thread, composer, and project panel tabs.
- **Localization**: Run tests in at least `en-US`, `es-MX`, `fr-CA` verifying ICU message formatting and RTL layout for `ar`.

### 4. Performance
- Benchmark reducers for timeline updates with 5k messages (guard p95 ≤ 5 ms per event).
- Simulate virtualization with windowed dataset ensuring no unbounded memory growth.

### 5. Security & Privacy
- Ensure no PII stored in local storage caches (unit test asserts redaction).  
- Verify audit events omit message bodies unless flagged for evidence (unit test on policy helper output).

### 6. Test Data & Fixtures
  - JSON fixtures live under `tests/frontend/messaging/fixtures/`:
    - `action_cards.json` — reschedule/deposit/custom action card exemplars.
    - `uploads.json` — pending and ready upload snapshots for Safe-Mode + scanning flows.
    - `safe_mode_matrix.json` — matrix verifying exposure vs band levels and override scenarios.

### 7. Tooling & CI
- Add `node --test tests/frontend/messaging/**/*.test.mjs` to standard run instructions.
- Ensure `make ci` (when available) runs frontend unit suite along with existing analytics/booking tests.
- Snapshot outputs stored using deterministic serialization to avoid platform-specific diffs.

### 8. Manual Verification Checklist (Post-UI)
- Validate cross-browser (Chrome, Safari, Firefox) for drag/drop shot list and upload handling.
- Conduct chaos scenario: disconnect network mid-send; ensure message stays `FAILED` with retry CTA.
- Verify mobile responsive layout (≥375px) for composer and action cards.

## Reporting
- Record test command outputs in run report + `tests.txt`.
- Capture coverage summaries once instrumentation added (future).
- Document known gaps and accepted risk waivers in run report Issues section.
