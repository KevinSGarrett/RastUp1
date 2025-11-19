const ONE_HOUR_MS = 60 * 60 * 1000;

const structuredCloneFn =
  typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone.bind(globalThis)
    : undefined;

function clone(value) {
  if (structuredCloneFn) {
    return structuredCloneFn(value);
  }
  return JSON.parse(JSON.stringify(value));
}

const STUB_INBOX_PAYLOAD = Object.freeze({
  threads: [
    {
      threadId: 'stub-project-1',
      kind: 'PROJECT',
      lastMessageAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      unreadCount: 2,
      pinned: true,
      archived: false,
      muted: false,
      safeModeRequired: false
    },
    {
      threadId: 'stub-inquiry-1',
      kind: 'INQUIRY',
      lastMessageAt: new Date(Date.now() - ONE_HOUR_MS * 8).toISOString(),
      unreadCount: 0,
      pinned: false,
      archived: false,
      muted: false,
      safeModeRequired: true
    }
  ],
  messageRequests: [
    {
      requestId: 'stub-request-1',
      threadId: 'stub-inquiry-2',
      creditCost: 1,
      expiresAt: new Date(Date.now() + ONE_HOUR_MS * 6).toISOString(),
      createdAt: new Date(Date.now() - ONE_HOUR_MS).toISOString()
    }
  ],
  rateLimit: {
    windowMs: ONE_HOUR_MS * 24,
    maxConversations: 5,
    initiations: []
  },
  credits: {
    available: 8,
    costPerRequest: 1,
    floor: 0
  }
});

function buildStubThreadPayload(threadId) {
  const now = new Date();
  const createdAt = now.toISOString();
  return {
    thread: {
      threadId,
      kind: threadId.includes('project') ? 'PROJECT' : 'INQUIRY',
      status: 'OPEN',
      safeModeRequired: threadId.includes('safe'),
      lastMessageAt: createdAt
    },
    messages: [
      {
        messageId: `${threadId}-msg-1`,
        createdAt,
        authorUserId: 'usr_buyer',
        type: 'TEXT',
        body: 'Welcome to the messaging workspace stub timeline.',
        attachments: [],
        nsfwBand: 0
      },
      {
        messageId: `${threadId}-msg-2`,
        createdAt: new Date(now.getTime() - ONE_HOUR_MS / 2).toISOString(),
        authorUserId: 'usr_seller',
        type: 'TEXT',
        body: 'This is a sample reply showing Safe-Mode friendly content.',
        attachments: [],
        nsfwBand: threadId.includes('safe') ? 1 : 0
      }
    ],
    actionCards: [],
    participants: [
      {
        userId: 'usr_buyer',
        role: 'BUYER',
        lastReadMsgId: `${threadId}-msg-2`,
        lastReadAt: createdAt
      },
      {
        userId: 'usr_seller',
        role: 'SELLER',
        lastReadMsgId: `${threadId}-msg-1`,
        lastReadAt: createdAt
      }
    ],
    projectPanel: {
      version: 1,
      tabs: {
        brief: {
          title: 'Stub project brief',
          summary:
            'This stub panel represents project metadata until GraphQL integration is configured.'
        },
        actions: []
      }
    },
    safeMode: {
      bandMax: threadId.includes('safe') ? 1 : 0,
      override: false
    },
    presenceTtlMs: 60_000
  };
}

const INBOX_QUERY = `
  query MessagingInbox($limit: Int, $cursor: String) {
    inbox(limit: $limit, cursor: $cursor) {
      threads {
        threadId
        kind
        lastMessageAt
        unreadCount
        pinned
        archived
        muted
        safeModeRequired
      }
      messageRequests {
        requestId
        threadId
        creditCost
        expiresAt
        createdAt
      }
      rateLimit {
        windowMs
        maxConversations
        initiations
      }
      credits {
        available
        costPerRequest
        floor
      }
    }
  }
`;

const THREAD_QUERY = `
  query MessagingThread($threadId: ID!) {
    thread(threadId: $threadId) {
      threadId
      kind
      status
      safeModeRequired
      lastMessageAt
      projectPanel {
        version
        tabs
      }
      safeMode {
        bandMax
        override
      }
      presenceTtlMs
      participants {
        userId
        role
        lastReadMsgId
        lastReadAt
      }
    }
    messages(threadId: $threadId, limit: 50) {
      edges {
        node {
          messageId
          createdAt
          authorUserId
          type
          body
          attachments
          nsfwBand
        }
      }
    }
    actionCards(threadId: $threadId, limit: 25) {
      edges {
        node {
          actionId
          type
          state
          version
          createdAt
          updatedAt
          payload
        }
      }
    }
  }
`;

const SEND_MESSAGE_MUTATION = `
  mutation MessagingSendMessage(
    $threadId: ID!,
    $body: String!,
    $clientId: String,
    $idempotencyKey: String
  ) {
    sendMessage(
      threadId: $threadId,
      body: $body,
      clientId: $clientId,
      idempotencyKey: $idempotencyKey
    ) {
      messageId
      createdAt
      authorUserId
      author { userId }
      type
      body
      attachments
      nsfwBand
      action {
        actionId
        type
        state
        version
        payload
        createdAt
        updatedAt
      }
    }
  }
`;

const MARK_THREAD_READ_MUTATION = `
  mutation MessagingMarkThreadRead(
    $threadId: ID!,
    $lastReadMsgId: ID,
    $lastReadAt: AWSDateTime
  ) {
    markThreadRead(
      threadId: $threadId,
      lastReadMsgId: $lastReadMsgId,
      lastReadAt: $lastReadAt
    ) {
      threadId
      lastReadMsgId
      lastReadAt
    }
  }
`;

const ACCEPT_MESSAGE_REQUEST_MUTATION = `
  mutation MessagingAcceptMessageRequest($requestId: ID!) {
    acceptMessageRequest(requestId: $requestId) {
      requestId
      threadId
      status
      creditsRemaining
    }
  }
`;

const DECLINE_MESSAGE_REQUEST_MUTATION = `
  mutation MessagingDeclineMessageRequest($requestId: ID!, $block: Boolean) {
    declineMessageRequest(requestId: $requestId, block: $block) {
      requestId
      threadId
      status
    }
  }
`;

const RECORD_CONVERSATION_START_MUTATION = `
  mutation MessagingRecordConversationStart($context: AWSJSON) {
    recordConversationStart(context: $context) {
      status
    }
  }
`;

const PIN_THREAD_MUTATION = `
  mutation MessagingPinThread($threadId: ID!) {
    pinThread(threadId: $threadId) {
      threadId
      pinned
    }
  }
`;

const UNPIN_THREAD_MUTATION = `
  mutation MessagingUnpinThread($threadId: ID!) {
    unpinThread(threadId: $threadId) {
      threadId
      pinned
    }
  }
`;

const ARCHIVE_THREAD_MUTATION = `
  mutation MessagingArchiveThread($threadId: ID!) {
    archiveThread(threadId: $threadId) {
      threadId
      archived
    }
  }
`;

const UNARCHIVE_THREAD_MUTATION = `
  mutation MessagingUnarchiveThread($threadId: ID!) {
    unarchiveThread(threadId: $threadId) {
      threadId
      archived
    }
  }
`;

const MUTE_THREAD_MUTATION = `
  mutation MessagingMuteThread($threadId: ID!) {
    muteThread(threadId: $threadId) {
      threadId
      muted
    }
  }
`;

const UNMUTE_THREAD_MUTATION = `
  mutation MessagingUnmuteThread($threadId: ID!) {
    unmuteThread(threadId: $threadId) {
      threadId
      muted
    }
  }
`;

const DEFAULT_GRAPHQL_MUTATIONS = Object.freeze({
  sendMessage: SEND_MESSAGE_MUTATION,
  markThreadRead: MARK_THREAD_READ_MUTATION,
  acceptMessageRequest: ACCEPT_MESSAGE_REQUEST_MUTATION,
  declineMessageRequest: DECLINE_MESSAGE_REQUEST_MUTATION,
  pinThread: PIN_THREAD_MUTATION,
  unpinThread: UNPIN_THREAD_MUTATION,
  archiveThread: ARCHIVE_THREAD_MUTATION,
  unarchiveThread: UNARCHIVE_THREAD_MUTATION,
  muteThread: MUTE_THREAD_MUTATION,
  unmuteThread: UNMUTE_THREAD_MUTATION,
  recordConversationStart: RECORD_CONVERSATION_START_MUTATION
});

function generateStubAttachmentId(threadId) {
  return `${threadId}-upload-${Math.random().toString(36).slice(2, 10)}`;
}

async function stubCreateUploadSession(threadId, descriptor = {}) {
  const attachmentId = descriptor.attachmentId ?? generateStubAttachmentId(threadId ?? 'stub-thread');
  return {
    attachmentId,
    uploadUrl: `https://stub-upload.example/${attachmentId}`,
    headers: {
      'x-stub-upload': 'true'
    },
    metadata: {
      threadId,
      fileName: descriptor.fileName ?? 'attachment.bin'
    }
  };
}

async function stubCompleteUpload(threadId, attachmentId) {
  return {
    attachmentId,
    threadId,
    status: 'READY',
    nsfwBand: 0
  };
}

async function stubGetUploadStatus(attachmentId) {
  return {
    attachmentId,
    status: 'READY',
    nsfwBand: 0
  };
}

async function executeGraphQL(query, variables, endpoint, headers, fetchImpl, logger) {
  if (!endpoint || !fetchImpl) {
    return null;
  }
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) {
      logger?.warn?.('messaging: GraphQL endpoint returned non-200 response', {
        status: response.status,
        statusText: response.statusText
      });
      return null;
    }
    const json = await response.json();
    if (json?.errors && json.errors.length > 0) {
      logger?.warn?.('messaging: GraphQL errors encountered', { errors: json.errors });
      return null;
    }
    return json?.data ?? null;
  } catch (error) {
    logger?.error?.('messaging: GraphQL request failed', { error });
    return null;
  }
}

export function createMessagingDataSource(options = {}) {
  const endpoint =
    options.endpoint ??
    (typeof window === 'undefined'
      ? (typeof process !== 'undefined' && process.env
          ? process.env.MESSAGING_GRAPHQL_ENDPOINT ?? null
          : null)
      : (typeof process !== 'undefined' && process.env
          ? process.env.NEXT_PUBLIC_MESSAGING_GRAPHQL_ENDPOINT ?? null
          : null));

  const defaultFetch =
    typeof fetch === 'function'
      ? (typeof window === 'undefined' ? fetch : fetch.bind(window))
      : null;

  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const headers = options.headers ?? {};
  const logger = options.logger;
  const useStubData = Boolean(options.useStubData) || !endpoint || !fetchImpl;

  const graphqlMutations =
    options.graphqlMutations === false
      ? {}
      : { ...DEFAULT_GRAPHQL_MUTATIONS, ...(options.graphqlMutations ?? {}) };

  const subscribeInboxImpl = typeof options.subscribeInbox === 'function' ? options.subscribeInbox : null;
  const subscribeThreadImpl =
    typeof options.subscribeThread === 'function' ? options.subscribeThread : null;

  const uploadOverrides = options.uploads ?? {};
  const uploadHandlers = {
    createUploadSession:
      typeof uploadOverrides.createUploadSession === 'function'
        ? uploadOverrides.createUploadSession
        : stubCreateUploadSession,
    completeUpload:
      typeof uploadOverrides.completeUpload === 'function'
        ? uploadOverrides.completeUpload
        : stubCompleteUpload,
    getUploadStatus:
      typeof uploadOverrides.getUploadStatus === 'function'
        ? uploadOverrides.getUploadStatus
        : stubGetUploadStatus
  };

  function pruneUndefined(input) {
    if (!input || typeof input !== 'object') {
      return input;
    }
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== null) {
        output[key] = value;
      }
    }
    return output;
  }

  function createStubMessageAck(threadId, input = {}) {
    const messageId = `${threadId}-stub-${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = new Date().toISOString();
    return {
      message: {
        messageId,
        createdAt,
        authorUserId: input.authorUserId ?? 'usr_stub',
        type: input.type ?? 'TEXT',
        body: typeof input.body === 'string' ? input.body : '',
        attachments: Array.isArray(input.attachments) ? clone(input.attachments) : [],
        action: null,
        nsfwBand: 0
      }
    };
  }

  async function defaultSendMessage(threadId, input = {}) {
    if (!threadId) {
      throw new Error('sendMessage requires threadId');
    }
    if (!input?.clientId) {
      throw new Error('sendMessage requires clientId in input');
    }
    if (!useStubData && graphqlMutations.sendMessage) {
      const variables = pruneUndefined({
        threadId,
        body: typeof input.body === 'string' ? input.body : '',
        clientId: input.clientId,
        idempotencyKey: input.idempotencyKey
      });
      const data = await executeGraphQL(
        graphqlMutations.sendMessage,
        variables,
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      const payload = data?.sendMessage ?? data?.message ?? null;
      if (payload) {
        return { message: payload };
      }
    }
    return createStubMessageAck(threadId, input);
  }

  async function defaultMarkThreadRead(threadId, ctx = {}) {
    if (!threadId) {
      throw new Error('markThreadRead requires threadId');
    }
    if (!useStubData && graphqlMutations.markThreadRead) {
      const variables = pruneUndefined({
        threadId,
        lastReadMsgId: ctx.lastReadMsgId,
        lastReadAt: ctx.lastReadAt
      });
      await executeGraphQL(
        graphqlMutations.markThreadRead,
        variables,
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return { status: 'synced' };
    }
    return { status: 'stub' };
  }

  async function defaultAcceptMessageRequest(requestId, ctx = {}) {
    if (!requestId) {
      throw new Error('acceptMessageRequest requires requestId');
    }
    if (!useStubData && graphqlMutations.acceptMessageRequest) {
      const data = await executeGraphQL(
        graphqlMutations.acceptMessageRequest,
        { requestId },
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      const payload = data?.acceptMessageRequest ?? data?.messageRequest ?? null;
      if (payload) {
        return payload;
      }
    }
    return {
      requestId,
      status: 'ACCEPTED',
      resolvedAt: new Date().toISOString(),
      creditsRemaining: ctx.creditsRemaining ?? null
    };
  }

  async function defaultDeclineMessageRequest(requestId, ctx = {}) {
    if (!requestId) {
      throw new Error('declineMessageRequest requires requestId');
    }
    const block = Boolean(ctx.block);
    if (!useStubData && graphqlMutations.declineMessageRequest) {
      const data = await executeGraphQL(
        graphqlMutations.declineMessageRequest,
        { requestId, block },
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      const payload = data?.declineMessageRequest ?? data?.messageRequest ?? null;
      if (payload) {
        return payload;
      }
    }
    return {
      requestId,
      status: block ? 'BLOCKED' : 'DECLINED',
      resolvedAt: new Date().toISOString()
    };
  }

    async function defaultPinThread(threadId, ctx = {}) {
      if (!threadId) {
        throw new Error('pinThread requires threadId');
      }
      if (!useStubData && graphqlMutations.pinThread) {
        await executeGraphQL(
          graphqlMutations.pinThread,
          { threadId },
          endpoint,
          headers,
          fetchImpl,
          logger
        );
      }
      return {
        threadId,
        status: 'PINNED',
        pinned: true,
        at: new Date().toISOString(),
        context: ctx
      };
    }

    async function defaultUnpinThread(threadId, ctx = {}) {
      if (!threadId) {
        throw new Error('unpinThread requires threadId');
      }
      if (!useStubData && graphqlMutations.unpinThread) {
        await executeGraphQL(
          graphqlMutations.unpinThread,
          { threadId },
          endpoint,
          headers,
          fetchImpl,
          logger
        );
      }
      return {
        threadId,
        status: 'UNPINNED',
        pinned: false,
        at: new Date().toISOString(),
        context: ctx
      };
    }

    async function defaultArchiveThread(threadId, ctx = {}) {
      if (!threadId) {
        throw new Error('archiveThread requires threadId');
      }
      if (!useStubData && graphqlMutations.archiveThread) {
        await executeGraphQL(
          graphqlMutations.archiveThread,
          { threadId },
          endpoint,
          headers,
          fetchImpl,
          logger
        );
      }
      return {
        threadId,
        status: 'ARCHIVED',
        archived: true,
        at: new Date().toISOString(),
        context: ctx
      };
    }

    async function defaultUnarchiveThread(threadId, ctx = {}) {
      if (!threadId) {
        throw new Error('unarchiveThread requires threadId');
      }
      if (!useStubData && graphqlMutations.unarchiveThread) {
        await executeGraphQL(
          graphqlMutations.unarchiveThread,
          { threadId },
          endpoint,
          headers,
          fetchImpl,
          logger
        );
      }
      return {
        threadId,
        status: 'UNARCHIVED',
        archived: false,
        at: new Date().toISOString(),
        context: ctx
      };
    }

    async function defaultMuteThread(threadId, ctx = {}) {
      if (!threadId) {
        throw new Error('muteThread requires threadId');
      }
      if (!useStubData && graphqlMutations.muteThread) {
        await executeGraphQL(
          graphqlMutations.muteThread,
          { threadId },
          endpoint,
          headers,
          fetchImpl,
          logger
        );
      }
      return {
        threadId,
        status: 'MUTED',
        muted: true,
        at: new Date().toISOString(),
        context: ctx
      };
    }

    async function defaultUnmuteThread(threadId, ctx = {}) {
      if (!threadId) {
        throw new Error('unmuteThread requires threadId');
      }
      if (!useStubData && graphqlMutations.unmuteThread) {
        await executeGraphQL(
          graphqlMutations.unmuteThread,
          { threadId },
          endpoint,
          headers,
          fetchImpl,
          logger
        );
      }
      return {
        threadId,
        status: 'UNMUTED',
        muted: false,
        at: new Date().toISOString(),
        context: ctx
      };
    }

  async function defaultRecordConversationStart(ctx = {}) {
    if (!useStubData && graphqlMutations.recordConversationStart) {
      const serialized = Object.keys(ctx ?? {}).length > 0 ? JSON.stringify(ctx) : null;
      await executeGraphQL(
        graphqlMutations.recordConversationStart,
        pruneUndefined({ context: serialized }),
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return { status: 'recorded' };
    }
    return { status: 'stub-recorded', at: new Date().toISOString() };
  }

  const mergedMutations = {
    sendMessage: options.mutations?.sendMessage ?? defaultSendMessage,
    markThreadRead: options.mutations?.markThreadRead ?? defaultMarkThreadRead,
    acceptMessageRequest: options.mutations?.acceptMessageRequest ?? defaultAcceptMessageRequest,
    declineMessageRequest: options.mutations?.declineMessageRequest ?? defaultDeclineMessageRequest,
    pinThread: options.mutations?.pinThread ?? defaultPinThread,
    unpinThread: options.mutations?.unpinThread ?? defaultUnpinThread,
    archiveThread: options.mutations?.archiveThread ?? defaultArchiveThread,
    unarchiveThread: options.mutations?.unarchiveThread ?? defaultUnarchiveThread,
    muteThread: options.mutations?.muteThread ?? defaultMuteThread,
    unmuteThread: options.mutations?.unmuteThread ?? defaultUnmuteThread,
    recordConversationStart:
      options.mutations?.recordConversationStart ?? defaultRecordConversationStart
  };

  function subscribeInbox(handlers = {}) {
    if (subscribeInboxImpl) {
      return subscribeInboxImpl(handlers);
    }
    return () => {};
  }

  function subscribeThread(threadId, handlers = {}) {
    if (subscribeThreadImpl) {
      return subscribeThreadImpl(threadId, handlers);
    }
    return () => {};
  }

  async function fetchInbox(args = {}) {
    if (!useStubData) {
      const data = await executeGraphQL(
        INBOX_QUERY,
        { limit: args.limit ?? 25, cursor: args.cursor ?? null },
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      if (data?.inbox) {
        return data.inbox;
      }
    }
    return clone(STUB_INBOX_PAYLOAD);
  }

  async function fetchThread(threadId, args = {}) {
    if (!threadId) {
      throw new Error('fetchThread requires threadId');
    }
    if (!useStubData) {
      const data = await executeGraphQL(
        THREAD_QUERY,
        { threadId },
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      if (data?.thread) {
        const payload = {
          thread: data.thread,
          messages: data.messages,
          actionCards: data.actionCards
        };
        if (args.includeParticipants === false) {
          // leave payload as-is; participants already included in thread selection when available
        }
        return payload;
      }
    }
    return buildStubThreadPayload(threadId);
  }

    async function createUploadSession(threadId, descriptor = {}) {
      if (!threadId) {
        throw new Error('createUploadSession requires threadId');
      }
      try {
        const result = await uploadHandlers.createUploadSession(threadId, descriptor);
        if (result) {
          return result;
        }
      } catch (error) {
        logger?.warn?.('messaging data source: createUploadSession handler failed', {
          error,
          threadId
        });
      }
      return stubCreateUploadSession(threadId, descriptor);
    }

    async function completeUpload(threadId, attachmentId, context = {}) {
      if (!attachmentId) {
        throw new Error('completeUpload requires attachmentId');
      }
      try {
        const result = await uploadHandlers.completeUpload(threadId, attachmentId, context);
        if (result) {
          return result;
        }
      } catch (error) {
        logger?.warn?.('messaging data source: completeUpload handler failed', {
          error,
          threadId,
          attachmentId
        });
      }
      return stubCompleteUpload(threadId, attachmentId);
    }

    async function getUploadStatus(attachmentId) {
      if (!attachmentId) {
        throw new Error('getUploadStatus requires attachmentId');
      }
      try {
        const result = await uploadHandlers.getUploadStatus(attachmentId);
        if (result) {
          return result;
        }
      } catch (error) {
        logger?.warn?.('messaging data source: getUploadStatus handler failed', {
          error,
          attachmentId
        });
      }
      return stubGetUploadStatus(attachmentId);
    }

  return {
    fetchInbox,
    fetchThread,
    createUploadSession,
    completeUpload,
    getUploadStatus,
    subscribeInbox,
    subscribeThread,
    mutations: mergedMutations
  };
}

export function getStubInboxPayload() {
  return clone(STUB_INBOX_PAYLOAD);
}

export function getStubThreadPayload(threadId = 'stub-thread') {
  return buildStubThreadPayload(threadId);
}
