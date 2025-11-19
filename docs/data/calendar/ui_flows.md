## Availability & Calendar UI Flows — WBS-017 (AGENT-3)

### Personas & Entry Points

- **Provider (Desktop/Web)**
  - Navigates to `Settings → Availability`.
  - Sees weekly calendar with copy/paste week actions, per-date overrides panel, and lead-time/booking-window controls.
  - Accesses `Calendar Connect` tab to add external ICS URLs, monitor sync status, and generate personal ICS feed tokens.
- **Provider (Mobile/RN)**
  - Similar flows with condensed layout; editor toggles between list/week view.
- **Operations/Admin**
  - Read-only overview for support escalation; can toggle debug mode to inspect holds/events timeline.

### Availability Editor Flow

1. **Load** — fetch `WeeklyRule[]`, `Exception[]`, and `CalEvent[]` preview window (`dateFrom` today → +30d).
2. **Weekly Rule Management**
   - Inline editing for weekday windows (drag handles or time pickers).
   - Copy/paste week template; modifications staged locally via headless `availabilityStore`.
   - Validation: ensure `endLocal > startLocal`, enforce min duration, highlight overlaps.
3. **Exceptions & Blackouts**
   - Calendar overlay displays overrides; click to add available/unavailable slice with notes.
   - Bulk vacation range uses range picker to create `unavailable` exceptions.
4. **Lead Time / Booking Window / Buffers**
   - Slider/number inputs update preview slots in real time by invoking feasibility engine.
5. **Preview Bookable Slots**
   - Right-side calendar shows computed FeasibleSlots; refresh on each edit.
   - Slot tooltip indicates applied rules (weekly, override, buffer) and conflicts removed.
6. **Save**
   - Batch mutation: `upsertWeeklyRule`, `upsertException` diffs posted; optimistic update with rollback on error.
7. **Hold Visualization (Read Only)**
   - Current holds displayed with TTL countdown; denoted as soft blocks distinct from confirmed events.

### Calendar Connect Flow

1. **Connect Source**
   - Enter ICS URL (private link); validation ensures HTTPS and token length.
   - POST `connectICS`; UI updates card to `Connected` pending initial poll.
2. **Sync Status**
   - Card displays `Last sync`, `Events imported`, `Errors`.
   - Poll via GraphQL subscription or interval query to update status.
3. **Error Handling**
   - If poller returns error, show actionable message with `Retry` button (triggers mutation to reset state).
   - Exponential backoff visualized via next retry ETA.
4. **Disconnect**
   - `disconnectExternal` mutation; confirmation modal warns downstream effect.

### Per-User ICS Feed Flow

1. **Generate Token**
   - Toggle `Include holds`; call `createIcsFeed`.
2. **Share Link**
   - Display masked URL with copy button; warn about revocation on leakage.
3. **Revoke/Regenerate**
   - Provide `Regenerate` action that invalidates old token (future backend support).

### Reschedule Picker Flow

1. Entry from booking thread/reschedule action.
2. Loads feasible slots for original duration ±14 days window.
3. Allows filtering by day/time-of-day; updates slot list when duration changes.
4. On selection, triggers `createHold` and surfaces countdown until hold expiry.

### State & Telemetry Hooks

- Central `calendarStore` exposes derived selectors: weekly templates, overrides, preview slots, sync statuses.
- Telemetry events emitted: `cal.ui.weekly_rule.updated`, `cal.ui.exception.added`, `cal.ui.sync.retry`, `cal.ui.hold.create`.
- Error boundaries wrap ICS connect components to capture parse/poll failures with stack traces & context.
