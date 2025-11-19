import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeEnvelopeStatus,
  verifyWebhookSignature,
  createESignAdapter
} from '../../services/docs/esign.js';
import { DocsError } from '../../services/docs/errors.js';
import { createHmac } from 'node:crypto';

test('normalizeEnvelopeStatus maps provider statuses to canonical values', () => {
  assert.equal(normalizeEnvelopeStatus('sent'), 'sent');
  assert.equal(normalizeEnvelopeStatus('delivered'), 'sent');
  assert.equal(normalizeEnvelopeStatus('completed'), 'completed');
  assert.equal(normalizeEnvelopeStatus('SIGNED'), 'completed');
  assert.equal(normalizeEnvelopeStatus('cancelled'), 'voided');
  assert.equal(normalizeEnvelopeStatus('Expired'), 'expired');
  assert.equal(normalizeEnvelopeStatus('unknown_status'), 'none');
});

test('verifyWebhookSignature validates HMAC and timestamp tolerance', () => {
  const secret = 'whsec_test';
  const timestamp = 1_738_000_000;
  const payload = `${timestamp}.{"event":"envelope.signed"}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const header = `t=${timestamp},v1=${signature}`;

  assert.doesNotThrow(() =>
    verifyWebhookSignature({
      header,
      secret,
      rawBody: '{"event":"envelope.signed"}',
      toleranceSeconds: 600,
      clock: () => timestamp * 1000
    })
  );

  assert.throws(
    () =>
      verifyWebhookSignature({
        header: `t=${timestamp},v1=deadbeef`,
        secret,
        rawBody: '{"event":"envelope.signed"}',
        toleranceSeconds: 600,
        clock: () => timestamp * 1000
      }),
    (error) => error instanceof DocsError && error.code === 'ENVELOPE_HMAC_INVALID'
  );

  assert.throws(
    () =>
      verifyWebhookSignature({
        header,
        secret,
        rawBody: '{"event":"envelope.signed"}',
        toleranceSeconds: 5,
        clock: () => (timestamp + 600) * 1000
      }),
    (error) => error instanceof DocsError && error.code === 'ENVELOPE_HMAC_INVALID'
  );
});

test('createESignAdapter delegates to transport and verifies webhook signatures', async () => {
  const secret = 'whsec_adapter';
  const timestamp = 1_738_100_000;
  const body = '{"status":"completed"}';
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  let capturedPayload = null;
  let voidedEnvelope = null;

  const transport = {
    async createEnvelope({ payload }) {
      capturedPayload = payload;
      return { envelopeId: 'env_123', signerUrls: { BUYER: 'https://sign/buyer' } };
    },
    async voidEnvelope({ envelopeId, reason }) {
      voidedEnvelope = { envelopeId, reason };
    }
  };

  const adapter = createESignAdapter({
    transport,
    webhookSecret: secret,
    callbackBaseUrl: 'https://rastup.example.com/docs',
    clock: () => new Date(timestamp * 1000)
  });

  const createResult = await adapter.createEnvelope({
    doc: {
      docId: 'doc_abc',
      packId: 'dpk_1',
      templateId: 'tpl_1',
      templateVersion: 1
    },
    signerMap: { BUYER: 'buyer@example.com' },
    pdfBuffer: Buffer.from('fake-pdf')
  });

  assert.equal(createResult.envelopeId, 'env_123');
  assert.equal(capturedPayload.docId, 'doc_abc');
  assert.equal(capturedPayload.recipients[0].link, 'https://rastup.example.com/docs/sign/doc_abc/BUYER');

  await adapter.voidEnvelope({ envelopeId: 'env_123', reason: 'superseded' });
  assert.deepEqual(voidedEnvelope, { envelopeId: 'env_123', reason: 'superseded' });

  assert.doesNotThrow(() =>
    adapter.verifyWebhook({
      signatureHeader: `t=${timestamp},v1=${signature}`,
      rawBody: body
    })
  );

  const normalized = adapter.normalizeWebhook({ envelopeId: 'env_123', status: 'SIGNED' });
  assert.equal(normalized.envelopeId, 'env_123');
  assert.equal(normalized.status, 'completed');
});
