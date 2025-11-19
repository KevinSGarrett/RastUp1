import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createThreadState,
  applyThreadEvent,
  enqueueOptimisticMessage,
  resolveOptimisticMessage,
  failOptimisticMessage,
  getPresenceSnapshot,
  getUnreadMessageIds,
  getActionCards
} from '../../../tools/frontend/messaging/thread_store.mjs';

const baseThreadInput = {
  thread: {
    threadId: 'thr-123',
    kind: 'PROJECT',
    status: 'OPEN',
    lastMessageAt: '2025-11-18T12:00:00.000Z'
  },
  messages: [
    {
      messageId: 'msg-1',
      createdAt: '2025-11-18T10:00:00.000Z',
      authorUserId: 'usr-buyer',
      type: 'TEXT',
      body: 'Hello from the buyer'
    },
    {
      messageId: 'msg-2',
      createdAt: '2025-11-18T11:00:00.000Z',
      authorUserId: 'usr-seller',
      type: 'TEXT',
      body: 'Hi there!'
    }
  ],
  actionCards: [
    {
      actionId: 'act-1',
      type: 'REQUEST_EXTRA',
      state: 'PENDING',
      version: 1,
      createdAt: '2025-11-18T11:05:00.000Z',
      updatedAt: '2025-11-18T11:05:00.000Z'
    }
  ],
  participants: [
    {
      userId: 'usr-buyer',
      role: 'BUYER',
      lastReadMsgId: 'msg-2',
      lastReadAt: '2025-11-18T11:10:00.000Z'
    },
    {
      userId: 'usr-seller',
      role: 'SELLER',
      lastReadMsgId: 'msg-2',
      lastReadAt: '2025-11-18T11:10:00.000Z'
    }
  ],
  safeMode: {
    bandMax: 1,
    override: false
  },
  presenceTtlMs: 60 * 1000
};

test('createThreadState normalizes message ordering', () => {
  const state = createThreadState(baseThreadInput);
  assert.deepEqual(state.messageOrder, ['msg-1', 'msg-2']);
  assert.equal(state.thread.lastMessageAt, '2025-11-18T12:00:00.000Z');
});

test('applyThreadEvent inserts messages chronologically and removes optimistic entries', () => {
  let state = createThreadState(baseThreadInput);
  state = enqueueOptimisticMessage(state, {
    clientId: 'local-1',
    createdAt: '2025-11-18T11:30:00.000Z',
    authorUserId: 'usr-buyer',
    body: 'Draft message'
  });
  assert.equal(state.messageOrder.at(-1), 'temp:local-1');

  state = resolveOptimisticMessage(state, 'local-1', {
    messageId: 'msg-3',
    createdAt: '2025-11-18T11:30:01.000Z',
    authorUserId: 'usr-buyer',
    type: 'TEXT',
    body: 'Draft message'
  });
  assert.equal(state.messageOrder.at(-1), 'msg-3');
  assert(!state.messageOrder.includes('temp:local-1'));
  assert.equal(state.thread.lastMessageAt, '2025-11-18T11:30:01.000Z');
});

test('failOptimisticMessage marks temporary message as failed', () => {
  let state = createThreadState(baseThreadInput);
  state = enqueueOptimisticMessage(state, {
    clientId: 'local-2',
    createdAt: '2025-11-18T12:00:00.000Z',
    authorUserId: 'usr-buyer',
    body: 'Will fail'
  });
  state = failOptimisticMessage(state, 'local-2', 'MSG_POLICY_BLOCKED');
  const tempId = state.optimisticByClientId['local-2'];
  assert.equal(state.messagesById[tempId].deliveryState, 'FAILED');
  assert.equal(state.messagesById[tempId].errorCode, 'MSG_POLICY_BLOCKED');
});

test('applyThreadEvent ignores stale action card versions and updates valid ones', () => {
  let state = createThreadState(baseThreadInput);
  state = applyThreadEvent(state, {
    type: 'ACTION_CARD_UPSERT',
    payload: {
      actionId: 'act-1',
      type: 'REQUEST_EXTRA',
      state: 'PAID',
      version: 2,
      updatedAt: '2025-11-18T12:00:00.000Z'
    }
  });
  assert.equal(state.actionCardsById['act-1'].state, 'PAID');
  assert.equal(state.actionCardsById['act-1'].version, 2);

  state = applyThreadEvent(state, {
    type: 'ACTION_CARD_UPSERT',
    payload: {
      actionId: 'act-1',
      type: 'REQUEST_EXTRA',
      state: 'DECLINED',
      version: 1
    }
  });
  assert.equal(state.actionCardsById['act-1'].state, 'PAID', 'stale version should be ignored');

  const cards = getActionCards(state);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].state, 'PAID');
});

test('presence updates prune entries after TTL', async () => {
  let state = createThreadState(baseThreadInput);
  const now = Date.now();
  state = applyThreadEvent(state, {
    type: 'PRESENCE_EVENT',
    payload: {
      userId: 'usr-buyer',
      lastSeen: new Date(now).toISOString(),
      typing: true
    }
  });
  let snapshot = getPresenceSnapshot(state, now + 1000);
  assert.equal(snapshot['usr-buyer'].typing, true);

  snapshot = getPresenceSnapshot(state, now + 120_000);
  assert.equal(Object.keys(snapshot).length, 0);
});

test('getUnreadMessageIds returns pending messages for participant', () => {
  const state = createThreadState({
    ...baseThreadInput,
    participants: [
      {
        userId: 'usr-buyer',
        role: 'BUYER',
        lastReadMsgId: 'msg-1'
      }
    ]
  });
  const unread = getUnreadMessageIds(state, 'usr-buyer');
  assert.deepEqual(unread, ['msg-2']);
});

test('project panel updates respect optimistic concurrency', () => {
  let state = createThreadState(baseThreadInput);
  state = applyThreadEvent(state, {
    type: 'PROJECT_PANEL_UPDATED',
    payload: {
      version: 1,
      tabs: { brief: { headline: 'Updated headline' } }
    }
  });
  assert.equal(state.projectPanel.version, 1);
  assert.equal(state.projectPanel.tabs.brief.headline, 'Updated headline');

  state = applyThreadEvent(state, {
    type: 'PROJECT_PANEL_UPDATED',
    payload: {
      version: 0,
      tabs: { brief: { headline: 'Stale headline' } }
    }
  });
  assert.equal(state.projectPanel.tabs.brief.headline, 'Updated headline');
});
