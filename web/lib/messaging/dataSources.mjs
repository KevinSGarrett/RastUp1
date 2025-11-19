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

const STUB_MODERATION_QUEUE = Object.freeze({
  cases: [
    {
      caseId: 'case-message-1',
      type: 'MESSAGE',
      threadId: 'stub-project-1',
      messageId: 'stub-project-1-msg-1',
      status: 'PENDING',
      severity: 'MEDIUM',
      reason: 'SPAM',
      reportedBy: 'usr_buyer',
      reportedAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
      metadata: { source: 'stub' }
    },
    {
      caseId: 'case-thread-1',
      type: 'THREAD',
      threadId: 'stub-inquiry-1',
      status: 'PENDING',
      severity: 'HIGH',
      reason: 'HARASSMENT',
      reportedBy: 'usr_support',
      reportedAt: new Date(Date.now() - ONE_HOUR_MS * 3).toISOString(),
      metadata: { source: 'stub' }
    }
  ]
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

const REPORT_MESSAGE_MUTATION = `
  mutation MessagingReportMessage(
    $threadId: ID!,
    $messageId: ID!,
    $reason: String,
    $notes: String,
    $severity: String
  ) {
    reportMessage(
      threadId: $threadId,
      messageId: $messageId,
      reason: $reason,
      notes: $notes,
      severity: $severity
    ) {
      caseId
      status
      severity
      reason
      moderation {
        state
        reason
        severity
        reportedAt
        auditTrailId
      }
    }
  }
`;

const REPORT_THREAD_MUTATION = `
  mutation MessagingReportThread($threadId: ID!, $reason: String, $notes: String, $severity: String) {
    reportThread(threadId: $threadId, reason: $reason, notes: $notes, severity: $severity) {
      caseId
      status
      severity
      reason
      moderation {
        state
        reason
        severity
        updatedAt
        auditTrailId
      }
    }
  }
`;

const LOCK_THREAD_MUTATION = `
  mutation MessagingLockThread($threadId: ID!, $reason: String, $notes: String, $severity: String) {
    lockThread(threadId: $threadId, reason: $reason, notes: $notes, severity: $severity) {
      threadId
      status
      moderation {
        state
        locked
        lockedAt
        reason
        severity
      }
    }
  }
`;

const UNLOCK_THREAD_MUTATION = `
  mutation MessagingUnlockThread($threadId: ID!, $notes: String) {
    unlockThread(threadId: $threadId, notes: $notes) {
      threadId
      status
      moderation {
        state
        locked
        lockedAt
        reason
        severity
      }
    }
  }
`;

const BLOCK_THREAD_MUTATION = `
  mutation MessagingBlockThread($threadId: ID!, $reason: String, $notes: String, $severity: String) {
    blockThread(threadId: $threadId, reason: $reason, notes: $notes, severity: $severity) {
      threadId
      status
      moderation {
        state
        blocked
        blockedAt
        reason
        severity
      }
    }
  }
`;

const UNBLOCK_THREAD_MUTATION = `
  mutation MessagingUnblockThread($threadId: ID!, $notes: String) {
    unblockThread(threadId: $threadId, notes: $notes) {
      threadId
      status
      moderation {
        state
        blocked
        blockedAt
        reason
        severity
      }
    }
  }
`;

const UPDATE_MODERATION_CASE_MUTATION = `
  mutation MessagingUpdateModerationCase($caseId: ID!, $patch: ModerationCasePatchInput!) {
    updateModerationCase(caseId: $caseId, patch: $patch) {
      caseId
      status
      severity
      reason
      metadata
      lastUpdatedAt
    }
  }
`;

const RESOLVE_MODERATION_CASE_MUTATION = `
  mutation MessagingResolveModerationCase($caseId: ID!, $resolution: ModerationCaseResolutionInput!) {
    resolveModerationCase(caseId: $caseId, resolution: $resolution) {
      caseId
      status
      resolution {
        outcome
        notes
        resolvedAt
        resolvedBy
      }
    }
  }
`;

const REMOVE_MODERATION_CASE_MUTATION = `
  mutation MessagingRemoveModerationCase($caseId: ID!) {
    removeModerationCase(caseId: $caseId) {
      caseId
      status
    }
  }
`;

const MODERATION_QUEUE_QUERY = `
  query MessagingModerationQueue($status: String, $limit: Int) {
    moderationQueue(status: $status, limit: $limit) {
      caseId
      type
      threadId
      messageId
      status
      severity
      reason
      reportedBy
      reportedAt
      metadata
      lastUpdatedAt
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
  reportMessage: REPORT_MESSAGE_MUTATION,
  reportThread: REPORT_THREAD_MUTATION,
  lockThread: LOCK_THREAD_MUTATION,
  unlockThread: UNLOCK_THREAD_MUTATION,
  blockThread: BLOCK_THREAD_MUTATION,
  unblockThread: UNBLOCK_THREAD_MUTATION,
  updateModerationQueueCase: UPDATE_MODERATION_CASE_MUTATION,
  resolveModerationQueueCase: RESOLVE_MODERATION_CASE_MUTATION,
  removeModerationQueueCase: REMOVE_MODERATION_CASE_MUTATION,
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

  async function defaultReportMessage(threadId, messageId, ctx = {}) {
    if (!threadId) {
      throw new Error('reportMessage requires threadId');
    }
    if (!messageId) {
      throw new Error('reportMessage requires messageId');
    }
    if (!useStubData && graphqlMutations.reportMessage) {
      const variables = pruneUndefined({
        threadId,
        messageId,
        reason: ctx.reason,
        notes: ctx.notes,
        severity: ctx.severity
      });
      const data = await executeGraphQL(
        graphqlMutations.reportMessage,
        variables,
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return data?.reportMessage ?? data?.case ?? null;
    }
    return {
      caseId: ctx.caseId ?? `stub-case-${Math.random().toString(36).slice(2, 8)}`,
      status: 'PENDING',
      severity: ctx.severity ?? 'MEDIUM',
      reason: ctx.reason ?? null,
      moderation: {
        state: 'REPORTED',
        reason: ctx.reason ?? null,
        severity: ctx.severity ?? 'MEDIUM',
        reportedAt: new Date().toISOString()
      }
    };
  }

  async function defaultReportThread(threadId, ctx = {}) {
    if (!threadId) {
      throw new Error('reportThread requires threadId');
    }
    if (!useStubData && graphqlMutations.reportThread) {
      const variables = pruneUndefined({
        threadId,
        reason: ctx.reason,
        notes: ctx.notes,
        severity: ctx.severity
      });
      const data = await executeGraphQL(
        graphqlMutations.reportThread,
        variables,
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return data?.reportThread ?? data?.case ?? null;
    }
    return {
      caseId: ctx.caseId ?? `stub-thread-case-${Math.random().toString(36).slice(2, 8)}`,
      status: 'PENDING',
      severity: ctx.severity ?? 'HIGH',
      reason: ctx.reason ?? null,
      moderation: {
        state: 'UNDER_REVIEW',
        reason: ctx.reason ?? null,
        severity: ctx.severity ?? 'HIGH',
        updatedAt: new Date().toISOString()
      }
    };
  }

  async function defaultLockThread(threadId, ctx = {}) {
    if (!threadId) {
      throw new Error('lockThread requires threadId');
    }
    if (!useStubData && graphqlMutations.lockThread) {
      const variables = pruneUndefined({
        threadId,
        reason: ctx.reason,
        notes: ctx.notes,
        severity: ctx.severity
      });
      const data = await executeGraphQL(
        graphqlMutations.lockThread,
        variables,
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return data?.lockThread ?? data?.thread ?? null;
    }
    return {
      threadId,
      status: 'LOCKED',
      moderation: {
        state: 'LOCKED',
        locked: true,
        lockedAt: new Date().toISOString(),
        reason: ctx.reason ?? null,
        severity: ctx.severity ?? 'HIGH'
      }
    };
  }

  async function defaultUnlockThread(threadId, ctx = {}) {
    if (!threadId) {
      throw new Error('unlockThread requires threadId');
    }
    if (!useStubData && graphqlMutations.unlockThread) {
      const variables = pruneUndefined({
        threadId,
        notes: ctx.notes
      });
      const data = await executeGraphQL(
        graphqlMutations.unlockThread,
        variables,
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return data?.unlockThread ?? data?.thread ?? null;
    }
    return {
      threadId,
      status: 'OPEN',
      moderation: {
        state: 'OPEN',
        locked: false,
        lockedAt: null
      }
    };
  }

  async function defaultBlockThread(threadId, ctx = {}) {
    if (!threadId) {
      throw new Error('blockThread requires threadId');
    }
    if (!useStubData && graphqlMutations.blockThread) {
      const variables = pruneUndefined({
        threadId,
        reason: ctx.reason,
        notes: ctx.notes,
        severity: ctx.severity
      });
      const data = await executeGraphQL(
        graphqlMutations.blockThread,
        variables,
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return data?.blockThread ?? data?.thread ?? null;
    }
    return {
      threadId,
      status: 'LOCKED',
      moderation: {
        state: 'BLOCKED',
        blocked: true,
        blockedAt: new Date().toISOString(),
        reason: ctx.reason ?? null,
        severity: ctx.severity ?? 'HIGH'
      }
    };
  }

  async function defaultUnblockThread(threadId, ctx = {}) {
    if (!threadId) {
      throw new Error('unblockThread requires threadId');
    }
    if (!useStubData && graphqlMutations.unblockThread) {
      const variables = pruneUndefined({
        threadId,
        notes: ctx.notes
      });
      const data = await executeGraphQL(
        graphqlMutations.unblockThread,
        variables,
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return data?.unblockThread ?? data?.thread ?? null;
    }
    return {
      threadId,
      status: 'OPEN',
      moderation: {
        state: 'OPEN',
        blocked: false,
        blockedAt: null
      }
    };
  }

  async function defaultUpdateModerationCase(caseId, patch = {}) {
    if (!caseId) {
      throw new Error('updateModerationQueueCase requires caseId');
    }
    if (!useStubData && graphqlMutations.updateModerationQueueCase) {
      const data = await executeGraphQL(
        graphqlMutations.updateModerationQueueCase,
        { caseId, patch },
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return data?.updateModerationCase ?? data?.case ?? null;
    }
    return {
      caseId,
      ...patch,
      lastUpdatedAt: new Date().toISOString()
    };
  }

  async function defaultResolveModerationCase(caseId, resolution = {}) {
    if (!caseId) {
      throw new Error('resolveModerationQueueCase requires caseId');
    }
    if (!useStubData && graphqlMutations.resolveModerationQueueCase) {
      const data = await executeGraphQL(
        graphqlMutations.resolveModerationQueueCase,
        { caseId, resolution },
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      return data?.resolveModerationCase ?? data?.case ?? null;
    }
    return {
      caseId,
      status: 'RESOLVED',
      resolution: {
        outcome: resolution.outcome ?? 'RESOLVED',
        notes: resolution.notes ?? null,
        resolvedAt: new Date().toISOString(),
        resolvedBy: resolution.resolvedBy ?? null
      }
    };
  }

  async function defaultRemoveModerationCase(caseId) {
    if (!caseId) {
      throw new Error('removeModerationQueueCase requires caseId');
    }
    if (!useStubData && graphqlMutations.removeModerationQueueCase) {
      await executeGraphQL(
        graphqlMutations.removeModerationQueueCase,
        { caseId },
        endpoint,
        headers,
        fetchImpl,
        logger
      );
    }
    return { caseId, removed: true };
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
    reportMessage: options.mutations?.reportMessage ?? defaultReportMessage,
    reportThread: options.mutations?.reportThread ?? defaultReportThread,
    lockThread: options.mutations?.lockThread ?? defaultLockThread,
    unlockThread: options.mutations?.unlockThread ?? defaultUnlockThread,
    blockThread: options.mutations?.blockThread ?? defaultBlockThread,
    unblockThread: options.mutations?.unblockThread ?? defaultUnblockThread,
    updateModerationQueueCase:
      options.mutations?.updateModerationQueueCase ?? defaultUpdateModerationCase,
    resolveModerationQueueCase:
      options.mutations?.resolveModerationQueueCase ?? defaultResolveModerationCase,
    removeModerationQueueCase:
      options.mutations?.removeModerationQueueCase ?? defaultRemoveModerationCase,
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

  async function fetchModerationQueueData(args = {}) {
    if (!useStubData) {
      const variables = pruneUndefined({
        status: args.status,
        limit: args.limit
      });
      const data = await executeGraphQL(
        MODERATION_QUEUE_QUERY,
        variables,
        endpoint,
        headers,
        fetchImpl,
        logger
      );
      if (data?.moderationQueue) {
        return {
          cases: Array.isArray(data.moderationQueue) ? data.moderationQueue : []
        };
      }
    }
    return clone(STUB_MODERATION_QUEUE);
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
    fetchModerationQueue: fetchModerationQueueData,
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

export function getStubModerationQueue() {
  return clone(STUB_MODERATION_QUEUE);
}
