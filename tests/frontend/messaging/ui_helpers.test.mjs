import assert from 'node:assert/strict';
import test from 'node:test';

import { createThreadState } from '../../../tools/frontend/messaging/thread_store.mjs';
import {
  groupMessagesByDay,
  summarizeParticipants,
  summarizePresence,
  formatRelativeTimestamp
} from '../../../tools/frontend/messaging/ui_helpers.mjs';

test('groupMessagesByDay clusters messages and applies Safe-Mode filtering', () => {
  const threadState = createThreadState({
    thread: {
      threadId: 'thr_123',
      kind: 'INQUIRY',
      safeModeRequired: true
    },
    messages: [
      {
        messageId: 'msg_1',
        createdAt: '2025-11-19T10:00:00Z',
        authorUserId: 'usr_buyer',
        type: 'TEXT',
        body: 'Hello from buyer',
        nsfwBand: 0
      },
      {
        messageId: 'msg_2',
        createdAt: '2025-11-19T10:05:00Z',
        authorUserId: 'usr_seller',
        type: 'TEXT',
        body: 'Hello from seller',
        nsfwBand: 0
      },
      {
        messageId: 'msg_3',
        createdAt: '2025-11-20T09:00:00Z',
        authorUserId: 'usr_seller',
        type: 'TEXT',
        body: 'NSFW preview should blur',
        nsfwBand: 2,
        attachments: [
          {
            attachmentId: 'att_1',
            fileName: 'preview.jpg',
            nsfwBand: 2,
            status: 'READY'
          }
        ]
      }
    ],
    participants: [
      { userId: 'usr_buyer', role: 'BUYER', lastReadMsgId: 'msg_2', lastReadAt: '2025-11-19T10:06:00Z' },
      { userId: 'usr_seller', role: 'SELLER', lastReadMsgId: 'msg_3', lastReadAt: '2025-11-20T09:00:00Z' }
    ],
    safeMode: { bandMax: 1, override: false }
  });

  const groups = groupMessagesByDay(threadState, {
    viewerUserId: 'usr_buyer',
    timezone: 'UTC'
  });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].messages.length, 2);
  assert.equal(groups[0].messages[0].direction, 'outgoing');
  assert.equal(groups[0].messages[1].direction, 'incoming');
  assert.equal(groups[1].messages.length, 1);
  assert.equal(groups[1].messages[0].redacted, true);
  assert.equal(groups[1].messages[0].attachments[0].display.displayState, 'blurred');
});

test('summaries derive participants and presence states', () => {
  const threadState = createThreadState({
    thread: { threadId: 'thr_abc', kind: 'PROJECT' },
    participants: [
      { userId: 'usr_viewer', role: 'BUYER', lastReadMsgId: 'msg_1', lastReadAt: '2025-11-19T10:00:00Z' },
      { userId: 'usr_other', role: 'SELLER', lastReadMsgId: null, lastReadAt: null }
    ]
  });
  threadState.presenceByUserId = {
    usr_viewer: { typing: false, lastSeen: '2025-11-19T10:00:30Z' },
    usr_other: { typing: true, lastSeen: '2025-11-19T10:00:10Z' }
  };

  const participants = summarizeParticipants(threadState, 'usr_viewer');
  assert.equal(participants.viewer?.userId, 'usr_viewer');
  assert.equal(participants.others.length, 1);

  const presence = summarizePresence(threadState, { now: Date.parse('2025-11-19T10:00:40Z') });
  const typingEntry = presence.find((entry) => entry.userId === 'usr_other');
  assert.equal(typingEntry?.status, 'typing');
  const viewerEntry = presence.find((entry) => entry.userId === 'usr_viewer');
  assert.equal(viewerEntry?.status, 'online');
});

test('formatRelativeTimestamp produces friendly labels', () => {
  const now = Date.parse('2025-11-19T10:10:00Z');
  assert.equal(formatRelativeTimestamp('2025-11-19T10:09:00Z', { now }), '1 min ago');
  assert.equal(formatRelativeTimestamp('2025-11-19T09:10:00Z', { now }), '1 hr ago');
  assert.equal(formatRelativeTimestamp('2025-11-12T10:10:00Z', { now }), 'Nov 12, 2025');
});
