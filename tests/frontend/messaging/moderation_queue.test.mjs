import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createModerationQueue,
  enqueueCase,
  updateCase,
  resolveCase,
  removeCase,
  selectCases,
  getPendingCases,
  getQueueStats,
  getCase
} from '../../../tools/frontend/messaging/moderation_queue.mjs';

function buildQueue() {
  return createModerationQueue({
    cases: [
      {
        caseId: 'case-1',
        type: 'message',
        severity: 'low',
        status: 'pending',
        threadId: 'thr-1',
        reportedBy: 'usr-1',
        metadata: { source: 'user' }
      },
      {
        caseId: 'case-2',
        type: 'thread',
        severity: 'high',
        status: 'resolved',
        requiresDualApproval: true,
        threadId: 'thr-2',
        approvals: [{ actorId: 'admin-1', decision: 'APPROVE', decidedAt: '2025-11-19T05:00:00.000Z' }],
        resolution: { outcome: 'RESOLVED', notes: 'completed', resolvedAt: '2025-11-19T06:00:00.000Z' }
      }
    ]
  });
}

test('createModerationQueue normalizes cases and computes stats', () => {
  const queue = buildQueue();
  assert.deepEqual(queue.order, ['case-1', 'case-2']);
  assert.equal(queue.casesById['case-1'].severity, 'LOW');
  assert.equal(queue.casesById['case-2'].status, 'RESOLVED');
  assert.deepEqual(getQueueStats(queue), { pending: 1, dualApproval: 0, resolved: 1 });
});

test('enqueueCase adds case to front by default and updates stats', () => {
  const queue = buildQueue();
  const next = enqueueCase(queue, {
    caseId: 'case-3',
    type: 'message',
    severity: 'medium',
    status: 'pending',
    requiresDualApproval: true
  });
  assert.notEqual(next, queue);
  assert.deepEqual(next.order, ['case-3', 'case-1', 'case-2']);
  assert.equal(next.casesById['case-3'].severity, 'MEDIUM');
  assert.deepEqual(getQueueStats(next), { pending: 2, dualApproval: 1, resolved: 1 });
});

test('enqueueCase with append=true inserts at end', () => {
  const queue = buildQueue();
  const next = enqueueCase(
    queue,
    {
      caseId: 'case-3',
      type: 'thread',
      severity: 'medium',
      status: 'pending'
    },
    { append: true }
  );
  assert.deepEqual(next.order, ['case-1', 'case-2', 'case-3']);
});

test('updateCase merges data immutably and keeps latest first', () => {
  const queue = buildQueue();
  const next = updateCase(queue, 'case-1', {
    severity: 'HIGH',
    approvals: [{ actorId: 'admin-2', decision: 'approve', decidedAt: '2025-11-19T07:00:00.000Z' }],
    metadata: { escalated: true }
  });
  assert.notEqual(next, queue);
  assert.equal(next.casesById['case-1'].severity, 'HIGH');
  assert.equal(next.casesById['case-1'].approvals[0].decision, 'APPROVE');
  assert.equal(next.order[0], 'case-1');
  assert.equal(queue.casesById['case-1'].severity, 'LOW', 'original queue should remain unchanged');
});

test('resolveCase marks case resolved and moves to end', () => {
  const queue = buildQueue();
  const next = resolveCase(queue, 'case-1', {
    outcome: 'remediated',
    notes: 'actions taken',
    resolvedBy: 'admin-1',
    resolvedAt: '2025-11-19T08:00:00.000Z'
  });
  assert.equal(next.casesById['case-1'].status, 'RESOLVED');
  assert.equal(next.order[next.order.length - 1], 'case-1');
  assert.equal(next.casesById['case-1'].resolution.outcome, 'REMEDIATED');
});

test('removeCase deletes case and updates stats', () => {
  const queue = buildQueue();
  const next = removeCase(queue, 'case-1');
  assert.equal(next.order.includes('case-1'), false);
  assert.equal(next.casesById['case-1'], undefined);
  assert.deepEqual(getQueueStats(next), { pending: 0, dualApproval: 0, resolved: 1 });
});

test('selectCases filters by status, severity, type, dual approval, threadId', () => {
  const queue = createModerationQueue({
    cases: [
      { caseId: 'case-1', status: 'pending', severity: 'low', type: 'message', threadId: 'thr-1' },
      { caseId: 'case-2', status: 'pending', severity: 'high', type: 'thread', requiresDualApproval: true, threadId: 'thr-2' },
      { caseId: 'case-3', status: 'resolved', severity: 'medium', type: 'message', threadId: 'thr-1' }
    ]
  });
  const pending = selectCases(queue, { status: 'pending' });
  assert.equal(pending.length, 2);
  const highSeverity = selectCases(queue, { severity: ['high'] });
  assert.equal(highSeverity.length, 1);
  assert.equal(highSeverity[0].caseId, 'case-2');
  const dualApproval = selectCases(queue, { requiresDualApproval: true });
  assert.equal(dualApproval.length, 1);
  const threadCases = selectCases(queue, { threadId: 'thr-1', status: ['pending', 'resolved'] });
  assert.equal(threadCases.length, 2);
});

test('getPendingCases returns shallow copies of pending cases', () => {
  const queue = buildQueue();
  const pending = getPendingCases(queue);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].caseId, 'case-1');
  pending[0].metadata = { mutated: true };
  const original = getCase(queue, 'case-1');
  assert.equal(original.metadata?.mutated, undefined);
});

test('getQueueStats returns zeroed stats for empty queue', () => {
  const queue = createModerationQueue();
  assert.deepEqual(getQueueStats(queue), { pending: 0, dualApproval: 0, resolved: 0 });
  const empty = getQueueStats();
  assert.deepEqual(empty, { pending: 0, dualApproval: 0, resolved: 0 });
});
