# Messaging UI Flows & Interaction Notes

## 1. Inbox & Message Requests

1. **Initial load**
   - Fire `Query.inbox(limit, cursor)` → returns ordered thread edges and `newRequestCount`.
   - Preferred: call `createMessagingClient.refreshInbox()` which handles normalization + controller hydration (internally invokes `normalizeInboxPayload`).
   - If bypassing the client helper, run result through `normalizeInboxPayload` (`tools/frontend/messaging/normalizers.mjs`) before calling `MessagingController.hydrateInbox()` to guarantee consistent shapes.
   - For thread detail queries, use `createMessagingClient.hydrateThread(threadId, { subscribe: true })` to normalize via `normalizeThreadPayload`, hydrate controller, and start subscriptions. Manual path still available via direct controller calls when needed.
    - Wrap Next.js layouts with `MessagingProvider` (`web/components/MessagingProvider`) so the controller/client are available via context; call `useInboxThreads`, `useInboxSummary`, and `useNotifications` inside inbox surfaces to obtain reactive slices without manually wiring subscriptions.
     - `MessagingInbox` (`web/components/Messaging/MessagingInbox.tsx`) provides a default inbox surface covering pinned/default/archived folders, message request actions (accept/decline/block), and credit/rate limit affordances—pass `onSelectThread` to drive the active thread view.
     - Filter/search controls: built-in search input, unread/project/inquiry toggles, Safe-Mode-only toggle, and muted mode cycler (all backed by `selectInboxThreads` filters). Use `defaultFilters`, `onFiltersChange`, and `initialSearch` props to seed or observe filter state so routes can persist selections (e.g., query params).
    - For thread pages, call `useThread(threadId)` (optionally pairing with `startThreadSubscription`) to receive live message/action card state and `useMessagingActions()` for mutation helpers.
- `createMessagingNextAdapter` (`tools/frontend/messaging/next_adapter.mjs`) exposes `prefetch`, `createProviderProps`, and `createRuntime` helpers so Next.js routes can server-render inbox + thread payloads, then hydrate the same controller/client on the client. Pair these with `MessagingWorkspace` (`web/components/Messaging/MessagingWorkspace.tsx`) for a ready-made layout that composes provider, inbox list, thread timeline, and project panel snapshots.
  - The application route `web/app/messaging/page.tsx` calls `createMessagingNextAdapter.prefetch()` using shared GraphQL data sources (`web/lib/messaging/dataSources.mjs`) and passes the snapshot into the client-only `MessagingWorkspaceClient.tsx`, which reinstantiates `MessagingProvider` and `MessagingWorkspaceRouteBridge` on the browser while preserving initial filters, search terms, and selected thread sourced from query parameters.
   - Compute folders: `default`, `pinned`, `archived`, `requests`.
- `MessagingWorkspaceRouteBridge` (`web/components/Messaging/MessagingWorkspaceRouteBridge.tsx`) keeps inbox filters/search/thread selection in sync with Next.js query params (`thread`, `unread`, `kinds`, `muted`, `safe`, `search`) using `filter_params.mjs`; changes update the URL via `router.replace`/`router.push` while reflecting back into the workspace.
2. **Message request handling**
   - Each request entry carries `requestId`, `creditCost`, `expiresAt`.
   - Composer disabled until user accepts (unless same LBG).
   - Actions:
     - `acceptMessageRequest(requestId)` → on success, move thread to default folder and deduct credits (helper returns `creditsRemaining`).
     - `declineMessageRequest(requestId)` → mark `status: DECLINED`, hide from inbox, notify requester.
     - `blockSender(userId)` → thread remains hidden, emit audit event for T&S.
3. **Rate limits**
   - Before enabling `Start new conversation`, call `canInitiateConversation({creditsRemaining, sentInWindow, windowLimit})`.
   - When limit exceeded, show inline banner with next reset time.

## 2. Thread Timeline

1. **Hydration**
   - `Query.thread(threadId)` returns thread header, participants, project panel snapshot, and paginated `messages`.
   - Use `ThreadStore.hydrate()` to store base state (`messages`, `readReceipts`, `typing` set empty).
   - Set `activeTab` using `safeModeRequired` (default to `Brief`).
2. **Realtime updates**
   - `createMessagingClient.startInboxSubscription()` and `startThreadSubscription(threadId)` wrap AppSync subscriptions, translating envelopes with `mapInboxEventEnvelope` / `mapThreadEventEnvelope` and applying them to the controller.
   - Manual flow: `Subscription.threadEvents(threadId)` yields envelopes `{type: "MESSAGE_CREATED"|"MESSAGE_UPDATED"|"ACTION_UPDATED"|"PRESENCE"|"THREAD_LOCKED", payload}` which reducers merge by `messageId` / `actionId`; ensures chronological insertion using `createdAt` + tie breaker on `messageId`.
    - Optimistic messages with `clientId` are reconciled by `createMessagingClient.sendMessage()` (auto resolves) or the direct controller helpers (`resolveOptimisticMessage`, `failOptimisticMessage`).
     - `MessagingThread` (`web/components/Messaging/MessagingThread.tsx`) hydrates/ subscribes automatically, renders day-grouped timelines with Safe-Mode aware bodies/attachments, surfaces action card transitions, and exposes a policy-aware composer (nudges vs hard blocks).
      - Action card panel consumes `presentActionCard` results so each type shows friendly titles, contextual metadata, evidence attachments, and CTA labels instead of raw JSON payloads.
3. **Read receipts**
   - On focus, call `markThreadRead(threadId, lastMessageId)` and update local `participants[].lastReadMsgId`.
   - Show avatars stacked under the last read message.
4. **Composer lifecycle**
   - Input passes through `policy.evaluateText()` each keystroke chunk (debounced 300 ms).  
     - `ALLOW`: no UI change.  
     - `NUDGE`: render banner, allow send.  
     - `BLOCK`: disable send button, highlight offending text.
   - Attachments:
     - Choose file -> call `prepareUpload(threadId, { fileName, mimeType, sizeBytes, file })` which registers the upload, requests signed URL metadata, and updates composer state.
     - While uploading, show `status: "UPLOADING"` with progress; disable send until every pending upload reports `READY`.
     - On upload success -> `applyAttachmentStatus({ attachmentId, status: "READY" })`; timeline renders placeholder card with Safe-Mode overlay until backend marks final state.
     - While status remains `SCANNING`, the client polls `getUploadStatus` via `createMessagingClient.prepareUpload`; when the server responds `READY`/`QUARANTINED`, the composer chips update in place, and after repeated `SCANNING` responses the client marks the upload `FAILED` with `UPLOAD_STATUS_TIMEOUT`.
   - Send message:
     - Compose `sendMessage` mutation with temp `clientId`.  
     - Optimistically insert `temp` message with `deliveryState: "SENDING"`.  
     - On ack success -> mark `deliveryState: "SENT"` and replace `messageId`.  
     - On error -> mark `deliveryState: "FAILED"` and expose retry button.

## 3. Project Panel Tabs

1. **Brief & Moodboard**
   - Edit actions open modal with local draft state.  
   - Save triggers `updateProjectPanelTab` mutation carrying `version`.  
   - Conflict response `PANEL_VERSION_CONFLICT` surfaces diff modal with `server` vs `local` diff; user can merge or overwrite.
2. **Shot list**
   - Uses Kanban-like list; `ThreadStore` stores `shotItems` keyed by `id`.
   - Drag reorder updates local order and optimistic `version`. Backend ack updates to canonical.
3. **Files**
   - Proof uploads follow same pipeline as messages but appear in Files tab + timeline.  
   - Finals require `manifestRef` entry (external link). UI collects provider + URL, validated via `verifyExternalManifest`.
4. **Docs**
   - Read-only statuses; if `status !== SIGNED`, surface call-to-action action card.
5. **Expenses**
   - Display aggregated `extras`, `overtime`, `refunds` with totals pulled from `ActionCard` states; re-computed client-side each update.
  6. **Actions**
      - Renders open and historical action cards using `presentProjectPanelActions`, surfacing pending badges, formatted metadata, and evidence attachments in a read-only list that mirrors the thread timeline presenter.
      - Transition CTAs remain disabled in the project panel until design-system buttons land; actionable flows continue to live within the thread timeline via `ThreadStore.transitionActionCard`.

## 4. Presence & Typing UX

1. Typing indicator triggered when composer text non-empty and user is active.  
   - `startTyping()` publishes ephemeral event, throttled to once per 5 seconds.  
   - `stopTyping()` invoked on blur/empty or after timeout.
2. Presence badge:
   - `ThreadStore` maintains `presenceByUserId` with `lastSeen` timestamp.  
   - Display "Active now" if < 30s old, "Last seen X min ago" when between 30s–24h, otherwise show date.

## 5. Moderation & Safety Flows

1. **Report**
   - User selects reason → `reportThread(threadId, reason, messageId?)`.  
   - Optimistically flag message (red banner) and disable composer until backend response (thread may lock).
2. **Block**
   - Confirm dialog explaining effect; on success, hide thread and send event to `InboxStore`.
3. **Safe-Mode toggle**
   - Only enabled for verified adults with override rights.  
   - Toggle updates `safeModeOverride` context; re-render attachments calling `safeMode.presentAttachment()`.
4. **Quarantine resolution**
   - If upload flagged (`status: QUARANTINED`), show admin status pill; allow user to view reason once backend clears.

## 6. Notifications & Quiet Hours

1. Each incoming thread event triggers `NotificationQueue.enqueue()` with severity.  
2. If user within quiet hours (pulled from §1.10 preference store), queue stores events for digest.  
3. When quiet hours exit, queue flushes and displays toast summary (`"3 new messages from Studio XYZ"`).

## 7. Action Card UX Sequences

1. **Reschedule**
   - Seller proposes new time via modal -> `proposeReschedule` mutation.  
   - Card inserted with `state: PENDING`.  
   - Buyer sees Accept/Decline CTA; accept calls `acceptReschedule`, updates card to `ACCEPTED`, timeline shows booking update with new times.
2. **Request Extra**
   - Seller enters name + price. On buyer approval -> display payment confirmation; when backend marks `state: PAID`, expenses tab updates totals.
3. **Deliverables**
   - Proof uploads behave like attachments but tie into Files tab; buyer can `approve` or `requestRevisions`.  
   - Revision request reopens card with `state: REVISION_REQUESTED` and optional additional charge.
4. **Deposit Claim / Dispute**
   - Studio initiates claim -> card requires evidence attachments; status updates after support decision; UI shows timeline with admin comments.

## 8. Admin & Audit Touchpoints (read-only for web app)

- Support/T&S agents access separate consoles (not built yet) but frontend must capture metadata for audit:  
  - Each moderation/approval CTA includes `context.auditTrailId`.  
  - Client logs `messaging.audit` event on each action with sanitized payload (IDs only).

## 9. Notification Center & Quiet Hours

1. **Controller integration**
   - `MessagingNotificationCenter` subscribes to the shared notification queue via `useNotifications()` and uses `useMessagingActions()` to call `enqueueNotification`, `flushNotifications`, `collectNotificationDigest`, and `listPendingNotifications`.
   - The component auto-flushes ready notifications (default interval configurable) and exposes callbacks so parent layouts can deep-link into threads when a toast is clicked.
2. **Quiet hour awareness**
   - Reads `notificationState.quietHours` to display the configured window and surfaces real-time status (`active` vs `inactive`), polling every 60 s by default.
   - Deferred notifications (quiet-hours gated) remain in the queue list until `flushNotifications` runs outside the quiet window.
3. **Digest summaries**
   - `collectNotificationDigest` aggregates deferred items beyond the digest window, surfacing counts, highest severity, and sample messages; users can trigger via CTA or allow the auto interval to run.
4. **Workspace placement**
   - `MessagingWorkspace` accepts `showNotificationCenter` + `notificationCenterProps` to inject the panel into the sidebar beneath the inbox. Alternate placements can compose the standalone component directly.
5. **Fallback behaviour**
   - When notification actions are not provided (e.g., stubs), the component degrades gracefully by rendering static “No notifications” states without throwing.
