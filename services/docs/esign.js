import { createHmac, timingSafeEqual } from 'node:crypto';
import { DocsError, assertDocs } from './errors.js';
import { ENVELOPE_STATUSES } from './domain.js';

function parseSignatureHeader(header) {
  if (!header || typeof header !== 'string') {
    throw new DocsError('ENVELOPE_HMAC_INVALID', 'Missing signature header.');
  }
  const pairs = header.split(',').map((chunk) => chunk.trim());
  const parsed = {};
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key && value) {
      parsed[key] = value;
    }
  }
  if (!parsed.t || !parsed.v1) {
    throw new DocsError('ENVELOPE_HMAC_INVALID', 'Signature header missing timestamp or signature.');
  }
  return { timestamp: Number(parsed.t), signature: parsed.v1 };
}

function computeHmac(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function normalizeEnvelopeStatus(status) {
  if (!status) {
    return 'none';
  }
  const normalized = String(status).toLowerCase();
  switch (normalized) {
    case 'sent':
    case 'delivered':
      return 'sent';
    case 'completed':
    case 'signed':
      return 'completed';
    case 'voided':
    case 'cancelled':
      return 'voided';
    case 'expired':
      return 'expired';
    default:
      return ENVELOPE_STATUSES.has(normalized) ? normalized : 'none';
  }
}

export function verifyWebhookSignature({
  header,
  secret,
  rawBody,
  toleranceSeconds = 300,
  clock = () => Date.now()
}) {
  assertDocs(secret, 'ENVELOPE_HMAC_MISSING_SECRET', 'Webhook secret is required for signature verification.');
  const { timestamp, signature } = parseSignatureHeader(header);
  assertDocs(Number.isFinite(timestamp), 'ENVELOPE_HMAC_INVALID', 'Signature timestamp invalid.', { header });

  const payload = `${timestamp}.${rawBody ?? ''}`;
  const expected = computeHmac(secret, payload);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');

  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new DocsError('ENVELOPE_HMAC_INVALID', 'Webhook signature verification failed.');
  }

  const ageSeconds = Math.abs(clock() - timestamp * 1000) / 1000;
  if (ageSeconds > toleranceSeconds) {
    throw new DocsError('ENVELOPE_HMAC_INVALID', 'Webhook signature timestamp outside tolerable window.', {
      timestamp,
      ageSeconds,
      toleranceSeconds
    });
  }

  return true;
}

export function createEnvelopePayload({ doc, signerMap, callbackBaseUrl }) {
  assertDocs(doc, 'ENVELOPE_DOC_REQUIRED', 'Document payload required for envelope creation.');
  assertDocs(callbackBaseUrl, 'ENVELOPE_CALLBACK_REQUIRED', 'Callback base URL is required.');
  const recipients = Object.entries(signerMap ?? {}).map(([role, email]) => ({
    role,
    email,
    link: `${callbackBaseUrl}/sign/${doc.docId}/${role}`
  }));
  return {
    docId: doc.docId,
    templateId: doc.templateId,
    signerMap,
    recipients,
    metadata: {
      packId: doc.packId,
      templateVersion: doc.templateVersion
    }
  };
}

export function createESignAdapter({
  transport,
  webhookSecret,
  callbackBaseUrl,
  clock = () => new Date()
}) {
  assertDocs(transport && typeof transport.createEnvelope === 'function', 'ENVELOPE_TRANSPORT_INVALID', 'Transport must implement createEnvelope().');
  assertDocs(typeof transport.voidEnvelope === 'function', 'ENVELOPE_TRANSPORT_INVALID', 'Transport must implement voidEnvelope().');
  assertDocs(callbackBaseUrl, 'ENVELOPE_CALLBACK_REQUIRED', 'Callback base URL is required.');

  return {
    async createEnvelope({ doc, pdfBuffer, signerMap }) {
      const payload = createEnvelopePayload({ doc, signerMap, callbackBaseUrl });
      const response = await transport.createEnvelope({ payload, pdfBuffer });
      if (!response || !response.envelopeId) {
        throw new DocsError('ENVELOPE_CREATE_FAIL', 'Transport did not return an envelopeId.', { response });
      }
      return {
        envelopeId: response.envelopeId,
        signerUrls: response.signerUrls ?? {},
        payload
      };
    },
    async voidEnvelope({ envelopeId, reason = 'superseded' }) {
      assertDocs(envelopeId, 'ENVELOPE_ID_REQUIRED', 'envelopeId is required to void an envelope.');
      await transport.voidEnvelope({ envelopeId, reason });
      return { envelopeId, voided: true };
    },
    verifyWebhook({ signatureHeader, rawBody }) {
      verifyWebhookSignature({
        header: signatureHeader,
        secret: webhookSecret,
        rawBody,
        clock: () => clock().getTime()
      });
      return true;
    },
    normalizeWebhook(payload) {
      return {
        envelopeId: payload?.envelopeId ?? payload?.envelope_id ?? null,
        status: normalizeEnvelopeStatus(payload?.status),
        eventType: payload?.eventType ?? payload?.event_type ?? null,
        occurredAt: payload?.occurredAt ?? payload?.occurred_at ?? null,
        recipient: payload?.recipient ?? null,
        raw: payload
      };
    }
  };
}
