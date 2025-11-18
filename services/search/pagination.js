import crypto from 'node:crypto';

function checksumPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

/**
 * Encode a cursor token with tamper-evident checksum.
 * @param {import('./types').CursorToken} token
 */
export function encodeCursor(token) {
  const basePayload = {
    page: token.page,
    pageSize: token.pageSize,
    lastScore: token.lastScore ?? null,
    personalizationKey: token.personalizationKey ?? null
  };
  const checksum = checksumPayload(basePayload);
  const wrapped = { ...basePayload, checksum };
  return Buffer.from(JSON.stringify(wrapped), 'utf8').toString('base64url');
}

/**
 * Decode a cursor token and verify checksum.
 * @param {string | null} cursor
 * @returns {{ok: boolean; value?: import('./types').CursorToken; error?: string}}
 */
export function decodeCursor(cursor) {
  if (!cursor) {
    return { ok: false, error: 'EMPTY_CURSOR' };
  }
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    const { checksum, ...rest } = payload;
    if (!checksum || checksum !== checksumPayload(rest)) {
      return { ok: false, error: 'CURSOR_CHECKSUM_MISMATCH' };
    }
    return {
      ok: true,
      value: {
        page: Number(rest.page),
        pageSize: Number(rest.pageSize),
        lastScore: rest.lastScore ?? undefined,
        personalizationKey: rest.personalizationKey ?? undefined,
        checksum
      }
    };
  } catch (error) {
    return { ok: false, error: 'CURSOR_INVALID_FORMAT' };
  }
}
