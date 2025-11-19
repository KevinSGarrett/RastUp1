import { headers } from 'next/headers';
import type { Metadata } from 'next';

import { MessagingWorkspaceClient } from './MessagingWorkspaceClient';
import { createMessagingDataSource } from '../../lib/messaging/dataSources.mjs';
import { createMessagingNextAdapter } from '../../../tools/frontend/messaging/next_adapter.mjs';
import {
  DEFAULT_QUERY_KEYS,
  parseMessagingQueryState
} from '../../../tools/frontend/messaging/filter_params.mjs';

type SearchParams = Record<string, string | string[] | undefined>;

const serverDataSource = createMessagingDataSource({
  endpoint: process.env.MESSAGING_GRAPHQL_ENDPOINT ?? null,
  headers: (() => {
    const headersMap: Record<string, string> = {};
    if (process.env.MESSAGING_GRAPHQL_API_KEY) {
      headersMap.Authorization = `Bearer ${process.env.MESSAGING_GRAPHQL_API_KEY}`;
    }
    return headersMap;
  })(),
  useStubData: !process.env.MESSAGING_GRAPHQL_ENDPOINT
});

const messagingAdapter = createMessagingNextAdapter({
  fetchInbox: serverDataSource.fetchInbox,
  fetchThread: serverDataSource.fetchThread
});

export const metadata: Metadata = {
  title: 'Messaging Workspace',
  description:
    'Inbox, threads, and project panel workspace for managing inquiries and bookings with Safe-Mode aware messaging.'
};

function buildSearchParams(input: SearchParams | undefined) {
  const params = new URLSearchParams();
  if (!input) {
    return params;
  }
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== undefined && entry !== null) {
          params.append(key, String(entry));
        }
      }
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

function resolveViewerUserId(): string | null {
  try {
    const headerStore = headers();
    const headerUserId = headerStore.get('x-viewer-user-id');
    if (headerUserId) {
      return headerUserId;
    }
  } catch {
    // No headers available (likely during build/static render); fall back to unauthenticated view.
  }
  return null;
}

function resolveViewerRoles(): string[] {
  try {
    const headerStore = headers();
    const rolesHeader =
      headerStore.get('x-viewer-roles') ?? headerStore.get('x-viewer-role') ?? headerStore.get('x-user-roles');
    if (rolesHeader) {
      return rolesHeader
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  } catch {
    // Ignored
  }
  if (process.env.MESSAGING_VIEWER_ROLES) {
    return process.env.MESSAGING_VIEWER_ROLES.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function shouldShowModerationQueue(roles: string[]): boolean {
  const normalized = roles.map((role) => role.toLowerCase());
  const moderationRoles = new Set(['support', 'trust_safety', 'trust-safety', 'moderator', 'admin']);
  const flagOverride = process.env.MESSAGING_SHOW_MODERATION_QUEUE === 'true';
  return (
    flagOverride ||
    normalized.some((role) => moderationRoles.has(role))
  );
}

interface MessagingPageProps {
  searchParams?: SearchParams;
}

export default async function MessagingPage({ searchParams }: MessagingPageProps) {
  const viewerUserId = resolveViewerUserId();
  const viewerRoles = resolveViewerRoles();
  const showModerationQueue = shouldShowModerationQueue(viewerRoles);
  const urlSearchParams = buildSearchParams(searchParams);

  const parsedState = parseMessagingQueryState(urlSearchParams, {
    keys: DEFAULT_QUERY_KEYS
  });

  const threadIds = parsedState.threadId ? [parsedState.threadId] : [];

  const initialData = await messagingAdapter.prefetch({
    viewerUserId,
    threadIds,
    includeInbox: true,
    includeModerationQueue: showModerationQueue
  });

  return (
    <MessagingWorkspaceClient
      initialData={initialData}
      viewerUserId={viewerUserId}
      initialThreadId={parsedState.threadId ?? null}
      initialFilters={parsedState.filters}
      initialSearchTerm={parsedState.searchTerm}
      queryParamKeys={DEFAULT_QUERY_KEYS}
      showModerationQueue={showModerationQueue}
      moderationQueueProps={
        showModerationQueue
          ? {
              title: 'Moderation queue',
              statusFilter: undefined
            }
          : undefined
      }
    />
  );
}
