import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleDocPack,
  transitionPackStatus,
  computeRetentionTimestamp
} from '../../services/docs/domain.js';
import { createVariableResolver } from '../../services/docs/resolver.js';
import { DocsError } from '../../services/docs/errors.js';

const NOW = '2025-11-19T10:00:00Z';

function buildTemplate(overrides = {}) {
  return {
    templateId: 'tpl_talent_sow_v1',
    name: 'Talent SOW',
    version: 1,
    cityGate: ['houston'],
    roleGate: ['talent'],
    clauses: [
      { clauseId: 'cls_base_terms', version: 1 },
      { clauseId: 'cls_payment', version: 1 }
    ],
    layout: { header: 'RastUp' },
    signerRoles: [
      { role: 'BUYER', order: 1, required: true },
      { role: 'TALENT', order: 2, required: true }
    ],
    defaultVariables: { cancellation_policy_summary: '48h notice required' },
    variablesSchema: {
      service_date: { kind: 'date', description: 'Service date' },
      start_time: { kind: 'datetime', description: 'Start time' },
      end_time: { kind: 'datetime', description: 'End time' },
      total_price: { kind: 'money_cents', description: 'Total price' }
    },
    isActive: true,
    requiresDualApproval: true,
    approvalState: 'approved',
    approvalMetadata: {},
    createdBy: 'adm_legal_1',
    createdAt: '2025-11-18T12:00:00Z',
    ...overrides
  };
}

const CONTEXT = {
  lbgId: 'lbg_123',
  legId: 'leg_123',
  legType: 'talent',
  city: 'houston',
  roles: ['talent'],
  buyerUserId: 'buyer_1',
  sellerUserId: 'seller_1',
  variables: {
    buyerEmail: 'buyer@example.com',
    sellerEmail: 'talent@example.com',
    service_date: '2025-12-01',
    start_time: '2025-12-01T18:00:00Z',
    end_time: '2025-12-01T20:00:00Z',
    total_price: 125000
  }
};

const RESOLVER = createVariableResolver();

test('assembleDocPack composes documents with retention and signer maps', () => {
  const { pack, documents } = assembleDocPack({
    context: CONTEXT,
    templates: [buildTemplate()],
    resolver: RESOLVER,
    generatorVersion: 'docs-generator@1.0.0',
    nowIso: NOW,
    retentionYears: 7,
    idFactory: (prefix) => `${prefix}_001`
  });

  assert.equal(pack.packId, 'dpk_001');
  assert.equal(pack.status, 'draft');
  assert.equal(pack.docManifest.length, 1);
  assert.equal(pack.docManifest[0].docId, documents[0].docId);
  assert.equal(documents[0].docId, 'doc_001');
  assert.equal(documents[0].signerMap.BUYER, CONTEXT.variables.buyerEmail);
  assert.equal(documents[0].signerMap.TALENT, CONTEXT.variables.sellerEmail);

  const expectedRetention = computeRetentionTimestamp(NOW, { years: 7 });
  assert.equal(pack.wormRetainedUntil, expectedRetention);
  assert.equal(documents[0].wormRetainedUntil, expectedRetention);
});

test('assembleDocPack enforces gating and raises DOC_TEMPLATE_GATED when none applicable', () => {
  assert.throws(
    () =>
      assembleDocPack({
        context: { ...CONTEXT, city: 'austin' },
        templates: [buildTemplate()],
        resolver: RESOLVER,
        generatorVersion: 'docs-generator@1.0.0',
        nowIso: NOW,
        idFactory: (prefix) => `${prefix}_002`
      }),
    (error) => error instanceof DocsError && error.code === 'DOC_TEMPLATE_GATED'
  );
});

test('assembleDocPack validates variable completeness and types', () => {
  assert.throws(
    () =>
      assembleDocPack({
        context: {
          ...CONTEXT,
          variables: {
            buyerEmail: 'buyer@example.com',
            sellerEmail: 'talent@example.com',
            service_date: '2025-12-01',
            start_time: '2025-12-01T18:00:00Z',
            end_time: 'invalid',
            total_price: -10
          }
        },
        templates: [buildTemplate()],
        resolver: RESOLVER,
        generatorVersion: 'docs-generator@1.0.0',
        nowIso: NOW,
        idFactory: (prefix) => `${prefix}_003`
      }),
    (error) => error instanceof DocsError && error.code === 'DOC_VARS_INVALID'
  );
});

test('transitionPackStatus updates timestamps and tracks supersede metadata', () => {
  const { pack } = assembleDocPack({
    context: CONTEXT,
    templates: [buildTemplate()],
    resolver: RESOLVER,
    generatorVersion: 'docs-generator@1.0.0',
    nowIso: NOW,
    idFactory: (prefix) => `${prefix}_004`
  });

  const issued = transitionPackStatus(pack, 'issued', { nowIso: '2025-11-19T10:05:00Z' });
  assert.equal(issued.status, 'issued');
  assert.equal(issued.issuedAt, '2025-11-19T10:05:00.000Z');

  const signed = transitionPackStatus(issued, 'signed', { nowIso: '2025-11-19T10:10:00Z' });
  assert.equal(signed.status, 'signed');
  assert.equal(signed.signedAt, '2025-11-19T10:10:00.000Z');

  const superseded = transitionPackStatus(signed, 'superseded', {
    nowIso: '2025-11-20T00:00:00Z',
    supersededBy: 'dpk_latest'
  });
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.supersededBy, 'dpk_latest');
});
