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

  return {
    fetchInbox,
    fetchThread
  };
}

export function getStubInboxPayload() {
  return clone(STUB_INBOX_PAYLOAD);
}

export function getStubThreadPayload(threadId = 'stub-thread') {
  return buildStubThreadPayload(threadId);
}
