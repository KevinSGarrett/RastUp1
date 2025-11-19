import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMessagingStateToSearchParams,
  DEFAULT_QUERY_KEYS,
  isFilterStateEqual,
  parseMessagingQueryState
} from '../../../tools/frontend/messaging/filter_params.mjs';

test('parseMessagingQueryState returns defaults when params absent', () => {
  const { filters, searchTerm, threadId } = parseMessagingQueryState('', { keys: DEFAULT_QUERY_KEYS });

  assert.deepEqual(filters, {
    onlyUnread: false,
    includeInquiries: true,
    includeProjects: true,
    mutedMode: 'all',
    safeModeOnly: false
  });
  assert.equal(searchTerm, '');
  assert.equal(threadId, null);
});

test('parseMessagingQueryState normalises kinds, booleans, and search values', () => {
  const params = new URLSearchParams();
  params.set('unread', '1');
  params.set('kinds', 'INQUIRY');
  params.append('kinds', 'project'); // mix case and duplicates
  params.set('muted', 'muted');
  params.set('safe', 'true');
  params.set('search', '  Studio ');
  params.set('thread', 'thr-123');

  const { filters, searchTerm, threadId } = parseMessagingQueryState(params, { keys: DEFAULT_QUERY_KEYS });

  assert.deepEqual(filters, {
    onlyUnread: true,
    includeInquiries: true,
    includeProjects: true,
    mutedMode: 'muted',
    safeModeOnly: true
  });
  assert.equal(searchTerm, 'Studio');
  assert.equal(threadId, 'thr-123');
});

test('applyMessagingStateToSearchParams writes and clears query parameters', () => {
  const params = new URLSearchParams('foo=bar');
  const updated = applyMessagingStateToSearchParams(
    params,
    {
      filters: {
        onlyUnread: true,
        includeInquiries: true,
        includeProjects: false,
        mutedMode: 'hidden',
        safeModeOnly: true
      },
      searchTerm: 'Studio X',
      threadId: 'thr-456'
    },
    { keys: DEFAULT_QUERY_KEYS }
  );

  assert.equal(updated.get('foo'), 'bar');
  assert.equal(updated.get('unread'), '1');
  assert.equal(updated.get('safe'), '1');
  assert.equal(updated.get('muted'), 'hidden');
  assert.equal(updated.get('kinds'), 'INQUIRY');
  assert.equal(updated.get('search'), 'Studio X');
  assert.equal(updated.get('thread'), 'thr-456');

  const reset = applyMessagingStateToSearchParams(
    updated,
    {
      filters: {
        onlyUnread: false,
        includeInquiries: true,
        includeProjects: true,
        mutedMode: 'all',
        safeModeOnly: false
      },
      searchTerm: '',
      threadId: null
    },
    { keys: DEFAULT_QUERY_KEYS }
  );

  assert.equal(reset.get('unread'), null);
  assert.equal(reset.get('safe'), null);
  assert.equal(reset.get('muted'), null);
  assert.equal(reset.get('kinds'), null);
  assert.equal(reset.get('search'), null);
  assert.equal(reset.get('thread'), null);
  assert.equal(reset.get('foo'), 'bar');
});

test('isFilterStateEqual honours defaults and flags', () => {
  const base = {
    onlyUnread: false,
    includeInquiries: true,
    includeProjects: true,
    mutedMode: 'all',
    safeModeOnly: false
  };

  assert.ok(isFilterStateEqual(base, { ...base }));
  assert.ok(isFilterStateEqual(base, {}));
  assert.ok(!isFilterStateEqual(base, { ...base, onlyUnread: true }));
  assert.ok(!isFilterStateEqual(base, { ...base, includeProjects: false }));
  assert.ok(!isFilterStateEqual(base, { ...base, mutedMode: 'muted' }));
});

