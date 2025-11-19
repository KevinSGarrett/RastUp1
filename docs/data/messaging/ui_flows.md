# Messaging UI Flows & Interaction Notes

## 1. Inbox & Message Requests

1. **Initial load**
   - Fire `Query.inbox(limit, cursor)` → returns ordered thread edges and `newRequestCount`.
   - Normalize results via `InboxStore.hydrate()` to seed thread map.
   - Compute folders: `default`, `pinned`, `archived`, `requests`.
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
   - `Subscription.threadEvents(threadId)` yields envelopes: `{type: "MESSAGE_CREATED"|"MESSAGE_UPDATED"|"ACTION_UPDATED"|"PRESENCE"|"THREAD_LOCKED", payload}`.
   - Reducer merges by `messageId` / `actionId`; ensures chronological insertion using `createdAt` + tie breaker on `messageId`.
   - For optimistic messages with `clientId`, match ack and replace placeholder.
3. **Read receipts**
   - On focus, call `markThreadRead(threadId, lastMessageId)` and update local `participants[].lastReadMsgId`.
   - Show avatars stacked under the last read message.
4. **Composer lifecycle**
   - Input passes through `policy.evaluateText()` each keystroke chunk (debounced 300 ms).  
     - `ALLOW`: no UI change.  
     - `NUDGE`: render banner, allow send.  
     - `BLOCK`: disable send button, highlight offending text.
   - Attachments:
     - Choose file -> request `getUploadSession()` (returns signed URL + `attachmentId`).
     - While uploading, show `status: "UPLOADING"`.  
     - On upload success -> call `notifyUploadComplete(attachmentId)`; timeline renders placeholder card with Safe-Mode overlay until backend marks `status: READY`.
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
   - List open action cards sorted by urgency (state + createdAt).  
   - Buttons delegate to `ThreadStore.transitionActionCard(actionId, intent)` which wraps the correct mutation.

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
