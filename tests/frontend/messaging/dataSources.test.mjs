import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMessagingDataSource,
  getStubInboxPayload,
  getStubModerationQueue,
  getStubThreadPayload
} from '../../../web/lib/messaging/dataSources.mjs';

test('createMessagingDataSource returns stub inbox payload when endpoint unavailable', async () => {
  const dataSource = createMessagingDataSource({
    endpoint: null,
    fetchImpl: null,
    useStubData: true
  });

  const inbox = await dataSource.fetchInbox();
  assert.deepEqual(inbox, getStubInboxPayload());
});

test('fetchModerationQueue returns stub data when endpoint unavailable', async () => {
  const dataSource = createMessagingDataSource({
    endpoint: null,
    fetchImpl: null,
    useStubData: true
  });

  const queue = await dataSource.fetchModerationQueue();
  assert.deepEqual(queue, getStubModerationQueue());
});

test('createMessagingDataSource forwards GraphQL request when endpoint provided', async () => {
  const requests = [];
  const responsePayload = {
    data: {
      inbox: {
        threads: [
          {
            threadId: 'thr_graphql_1',
            kind: 'PROJECT',
            lastMessageAt: '2025-11-19T18:00:00Z',
            unreadCount: 3,
            pinned: false,
            archived: false,
            muted: false,
            safeModeRequired: false
          }
        ],
        messageRequests: [],
        rateLimit: {
          windowMs: 86_400_000,
          maxConversations: 5,
          initiations: []
        },
        credits: {
          available: 9,
          costPerRequest: 1,
          floor: 0
        }
      }
    }
  };

  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const dataSource = createMessagingDataSource({
    endpoint: 'https://example.test/graphql',
    fetchImpl,
    useStubData: false
  });

  const inbox = await dataSource.fetchInbox({ limit: 10 });

  assert.equal(requests.length, 1);
  const parsedBody = JSON.parse(requests[0].init.body);
  assert.equal(parsedBody.variables.limit, 10);
  assert.deepEqual(inbox, responsePayload.data.inbox);
});

test('fetchModerationQueue forwards GraphQL request when endpoint provided', async () => {
  const requests = [];
  const responsePayload = {
    data: {
      moderationQueue: [
        {
          caseId: 'case-123',
          type: 'THREAD',
          threadId: 'thr_graphql_1',
          status: 'PENDING',
          severity: 'MEDIUM',
          reason: 'SPAM',
          reportedBy: 'usr_support',
          reportedAt: '2025-11-19T19:00:00Z',
          metadata: {}
        }
      ]
    }
  };

  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const dataSource = createMessagingDataSource({
    endpoint: 'https://example.test/graphql',
    fetchImpl,
    useStubData: false
  });

  const queue = await dataSource.fetchModerationQueue({ status: 'PENDING', limit: 10 });

  assert.equal(requests.length, 1);
  const parsedBody = JSON.parse(requests[0].init.body);
  assert.equal(parsedBody.variables.status, 'PENDING');
  assert.equal(parsedBody.variables.limit, 10);
  assert.deepEqual(queue.cases, responsePayload.data.moderationQueue);
});

test('createMessagingDataSource falls back to stub thread payload on failure', async () => {
  const dataSource = createMessagingDataSource({
    endpoint: 'https://example.test/graphql',
    fetchImpl: async () => {
      return new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    },
    useStubData: false
  });

  const threadId = 'thr_stub_test';
  const payload = await dataSource.fetchThread(threadId);

  const expected = getStubThreadPayload(threadId);

  assert.equal(payload.thread.threadId, expected.thread.threadId);
  assert.equal(payload.thread.status, expected.thread.status);
  assert.equal(Array.isArray(payload.messages), true);
  assert.equal(Array.isArray(payload.participants), true);
});

test('stub mutations sendMessage returns optimistic ack', async () => {
  const dataSource = createMessagingDataSource({
    endpoint: null,
    fetchImpl: null,
    useStubData: true
  });

  const result = await dataSource.mutations.sendMessage('thr_stub_mut', {
    clientId: 'client-1',
    body: 'Hello from stub',
    authorUserId: 'usr_author'
  });

  assert.ok(result);
  assert.ok(result.message.messageId.startsWith('thr_stub_mut-stub-'));
  assert.equal(result.message.body, 'Hello from stub');
  assert.equal(result.message.authorUserId, 'usr_author');
});

test('sendMessage invokes GraphQL mutation when endpoint configured', async () => {
  const mutationRequests = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.query.includes('MessagingSendMessage')) {
      mutationRequests.push(body);
      return new Response(
        JSON.stringify({
          data: {
            sendMessage: {
              messageId: 'msg_graphql_1',
              createdAt: '2025-11-19T20:00:00Z',
              authorUserId: 'usr_graphql',
              type: 'TEXT',
              body: body.variables.body,
              attachments: [],
              nsfwBand: 0,
              action: null
            }
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    return new Response(JSON.stringify({ data: { inbox: getStubInboxPayload() } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const dataSource = createMessagingDataSource({
    endpoint: 'https://example.test/graphql',
    fetchImpl,
    useStubData: false
  });

  const response = await dataSource.mutations.sendMessage('thr_graphql_mut', {
    clientId: 'client-graphql',
    body: 'GraphQL mutation message'
  });

  assert.equal(mutationRequests.length, 1);
  assert.equal(response.message.messageId, 'msg_graphql_1');
  assert.equal(response.message.body, 'GraphQL mutation message');
  assert.equal(response.message.authorUserId, 'usr_graphql');
});

test('subscribeInbox defaults to a noop subscription when not provided', () => {
  const dataSource = createMessagingDataSource({ useStubData: true });
  const unsubscribe = dataSource.subscribeInbox({ next: () => {} });
  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();
});

test('createUploadSession returns stub details when no overrides provided', async () => {
  const dataSource = createMessagingDataSource({ useStubData: true });
  const session = await dataSource.createUploadSession('thr-upload', {
    fileName: 'proof.png'
  });
  assert.ok(session.attachmentId);
  assert.ok(session.uploadUrl.includes(session.attachmentId));
});

test('completeUpload falls back to stub ready status', async () => {
  const dataSource = createMessagingDataSource({ useStubData: true });
  const status = await dataSource.completeUpload('thr-upload', 'att-xyz');
  assert.equal(status.status, 'READY');
  assert.equal(status.attachmentId, 'att-xyz');
});

test('upload handler overrides are invoked when provided', async () => {
  let createCalled = false;
  const dataSource = createMessagingDataSource({
    uploads: {
      createUploadSession: async () => {
        createCalled = true;
        return { attachmentId: 'att-custom', uploadUrl: 'https://upload.custom/session' };
      }
    }
  });

  const session = await dataSource.createUploadSession('thr-handler', { fileName: 'doc.pdf' });
  assert.ok(createCalled);
  assert.equal(session.attachmentId, 'att-custom');
});

test('thread management stub mutations return defaults', async () => {
  const dataSource = createMessagingDataSource({ useStubData: true });

  const pinResult = await dataSource.mutations.pinThread('thr-123');
  assert.equal(pinResult.status, 'PINNED');
  assert.equal(pinResult.pinned, true);

  const archiveResult = await dataSource.mutations.archiveThread('thr-123');
  assert.equal(archiveResult.archived, true);

  const unarchiveResult = await dataSource.mutations.unarchiveThread('thr-123');
  assert.equal(unarchiveResult.archived, false);

  const muteResult = await dataSource.mutations.muteThread('thr-123');
  assert.equal(muteResult.muted, true);

  const unmuteResult = await dataSource.mutations.unmuteThread('thr-123');
  assert.equal(unmuteResult.muted, false);
});

test('pinThread mutation executes GraphQL when endpoint configured', async () => {
  const mutationRequests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.query.includes('MessagingPinThread')) {
      mutationRequests.push(body);
      return new Response(
        JSON.stringify({
          data: {
            pinThread: {
              threadId: body.variables.threadId,
              pinned: true
            }
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    return new Response(JSON.stringify({ data: { inbox: getStubInboxPayload() } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const dataSource = createMessagingDataSource({
    endpoint: 'https://example.test/graphql',
    fetchImpl,
    useStubData: false
  });

  const result = await dataSource.mutations.pinThread('thr-pin');
  assert.equal(mutationRequests.length, 1);
  assert.equal(mutationRequests[0].variables.threadId, 'thr-pin');
  assert.equal(result.pinned, true);
});
