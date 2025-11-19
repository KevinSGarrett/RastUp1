import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createApprovalRequest,
  recordApprovalDecision,
  evaluateApprovalExpiration,
  buildFinanceActionLog,
  ApprovalError
} from '../../services/booking/approvals.js';

const NOW = '2025-11-19T05:00:00Z';

test('createApprovalRequest sets defaults and computes expiry window', () => {
  const request = createApprovalRequest({
    scope: 'payout_release',
    referenceId: 'pay_123',
    createdBy: 'adm_finance_1',
    approvalsRequired: 2,
    context: { amountCents: 50000 },
    expiresInHours: 4,
    nowIso: NOW,
    idFactory: (prefix) => `${prefix}_abc123`
  });

  assert.equal(request.approvalId, 'apr_abc123');
  assert.equal(request.status, 'pending');
  assert.equal(request.approvalsRequired, 2);
  assert.equal(request.approvalsObtained, 0);
  assert.deepEqual(request.context, { amountCents: 50000 });
  assert.equal(request.createdBy, 'adm_finance_1');
  assert.equal(request.createdAt, NOW);
  assert.equal(request.updatedAt, NOW);
  assert.ok(request.expiresAt);
  assert.equal(request.decisions.length, 0);
});

test('recordApprovalDecision increments approvals and finalizes when threshold met', () => {
  const request = createApprovalRequest({
    scope: 'refund_override',
    referenceId: 'rfd_123',
    createdBy: 'adm_finance_2',
    approvalsRequired: 2,
    nowIso: NOW,
    idFactory: (prefix) => `${prefix}_1`
  });

  const first = recordApprovalDecision({
    request,
    approver: 'adm_finance_a',
    decision: 'approve',
    nowIso: '2025-11-19T05:05:00Z',
    idFactory: (prefix) => `${prefix}_decision1`
  });

  assert.equal(first.request.approvalsObtained, 1);
  assert.equal(first.request.status, 'pending');
  assert.equal(first.decision.decisionId, 'apd_decision1');

  const second = recordApprovalDecision({
    request: first.request,
    approver: 'adm_finance_b',
    decision: 'approve',
    nowIso: '2025-11-19T05:06:00Z',
    idFactory: (prefix) => `${prefix}_decision2`
  });

  assert.equal(second.request.approvalsObtained, 2);
  assert.equal(second.request.status, 'approved');
  assert.equal(second.request.decisions.length, 2);
});

test('recordApprovalDecision rejects duplicate approvers and invalid decisions', () => {
  const request = createApprovalRequest({
    scope: 'deposit_capture',
    referenceId: 'dep_123',
    createdBy: 'adm_finance_3',
    nowIso: NOW,
    idFactory: (prefix) => `${prefix}_dup`
  });

  const first = recordApprovalDecision({
    request,
    approver: 'adm_finance_dup',
    decision: 'approve',
    nowIso: NOW,
    idFactory: (prefix) => `${prefix}_ok`
  });

  assert.throws(
    () =>
      recordApprovalDecision({
        request: first.request,
        approver: 'adm_finance_dup',
        decision: 'approve'
      }),
    (error) => error instanceof ApprovalError && error.code === 'APPROVER_DUPLICATE'
  );

  assert.throws(
    () =>
      recordApprovalDecision({
        request: first.request,
        approver: 'adm_other',
        decision: 'escalate'
      }),
    (error) => error instanceof ApprovalError && error.code === 'DECISION_INVALID'
  );
});

test('recordApprovalDecision handles reject path and prevents further approvals', () => {
  const request = createApprovalRequest({
    scope: 'refund_override',
    referenceId: 'rfd_456',
    createdBy: 'adm_finance_4',
    nowIso: NOW,
    idFactory: (prefix) => `${prefix}_rej`
  });

  const { request: rejectedRequest } = recordApprovalDecision({
    request,
    approver: 'adm_finance_x',
    decision: 'reject',
    reason: 'Policy violation',
    nowIso: '2025-11-19T05:10:00Z',
    idFactory: (prefix) => `${prefix}_rej1`
  });

  assert.equal(rejectedRequest.status, 'rejected');
  assert.equal(rejectedRequest.approvalsObtained, 0);

  assert.throws(
    () =>
      recordApprovalDecision({
        request: rejectedRequest,
        approver: 'adm_finance_y',
        decision: 'approve'
      }),
    (error) => error instanceof ApprovalError && error.code === 'APPROVAL_FINALIZED'
  );
});

test('evaluateApprovalExpiration transitions pending request to expired', () => {
  const request = createApprovalRequest({
    scope: 'payout_pause',
    referenceId: 'pay_789',
    createdBy: 'adm_finance_5',
    nowIso: '2025-11-19T01:00:00Z',
    expiresInHours: 1,
    idFactory: (prefix) => `${prefix}_exp`
  });

  const stillPending = evaluateApprovalExpiration(request, { nowIso: '2025-11-19T01:30:00Z' });
  assert.equal(stillPending.status, 'pending');

  const expired = evaluateApprovalExpiration(request, { nowIso: '2025-11-19T02:30:00Z' });
  assert.equal(expired.status, 'expired');
});

test('buildFinanceActionLog captures approval snapshot and decision metadata', () => {
  const request = createApprovalRequest({
    scope: 'reserve_release',
    referenceId: 'res_123',
    createdBy: 'adm_finance_6',
    nowIso: NOW,
    idFactory: (prefix) => `${prefix}_snap`
  });

  const { request: updated, decision } = recordApprovalDecision({
    request,
    approver: 'adm_finance_primary',
    decision: 'approve',
    nowIso: '2025-11-19T05:15:00Z',
    idFactory: (prefix) => `${prefix}_snapd`
  });

  const log = buildFinanceActionLog({
    approval: updated,
    decision,
    action: 'finance.reserve.release',
    subjectReference: 'leg_123',
    beforeState: { reserveCents: 10000 },
    afterState: { reserveCents: 0 },
    actorAdmin: 'adm_finance_primary',
    reason: 'Reserve release approved',
    nowIso: '2025-11-19T05:15:05Z',
    idFactory: (prefix) => `${prefix}_log`
  });

  assert.equal(log.logId, 'fal_log');
  assert.equal(log.approvalId, updated.approvalId);
  assert.equal(log.action, 'finance.reserve.release');
  assert.deepEqual(log.beforeState, { reserveCents: 10000 });
  assert.deepEqual(log.afterState, { reserveCents: 0 });
  assert.equal(log.actorAdmin, 'adm_finance_primary');
  assert.equal(log.decision.decisionId, decision.decisionId);
  assert.equal(log.approvalSnapshot.decisions.length, 1);
  assert.equal(log.metadata.decision.decisionId, decision.decisionId);
  assert.equal(log.metadata.approvalSnapshot.approvalId, updated.approvalId);
});
