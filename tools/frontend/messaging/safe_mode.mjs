const DEFAULT_SAFEMODE_BAND = 1;

/**
 * Computes effective Safe-Mode state for the current viewer.
 * @param {{
 *   threadSafeModeRequired?: boolean;
 *   threadBandMax?: number;
 *   userIsVerifiedAdult?: boolean;
 *   userOverrideRequested?: boolean;
 *   allowOverride?: boolean;
 *   userRole?: 'buyer'|'seller'|'admin';
 * }} ctx
 */
export function computeSafeModeState(ctx = {}) {
  const threadBandMax = Number.isInteger(ctx.threadBandMax) ? ctx.threadBandMax : DEFAULT_SAFEMODE_BAND;
  const safeModeRequired = Boolean(ctx.threadSafeModeRequired);
  const userIsAdult = Boolean(ctx.userIsVerifiedAdult);
  const overrideAllowed = Boolean(ctx.allowOverride) && userIsAdult && !safeModeRequired;
  const wantsOverride = Boolean(ctx.userOverrideRequested);

  const enabled = safeModeRequired || !overrideAllowed || !wantsOverride;
  const bandMax = enabled ? threadBandMax : Math.max(threadBandMax, 2);

  return {
    enabled,
    bandMax,
    overrideAllowed,
    reason: enabled
      ? safeModeRequired
        ? 'THREAD_REQUIRED'
        : !overrideAllowed
          ? 'NOT_ALLOWED'
          : 'USER_DISABLED'
      : 'OVERRIDE_ACTIVE'
  };
}

/**
 * Determines how an attachment should render under Safe-Mode.
 * @param {{
 *   nsfwBand?: number;
 *   safeMode?: { enabled: boolean; bandMax: number };
 *   status?: 'UPLOADING'|'SCANNING'|'READY'|'QUARANTINED'|'FAILED';
 *   quarantined?: boolean;
 * }} input
 */
export function getAttachmentDisplayState(input = {}) {
  const nsfwBand = Number.isInteger(input.nsfwBand) ? input.nsfwBand : 0;
  const safeMode = input.safeMode ?? { enabled: true, bandMax: DEFAULT_SAFEMODE_BAND };
  const status = input.status ?? (input.quarantined ? 'QUARANTINED' : 'READY');

  if (status === 'QUARANTINED') {
    return { displayState: 'quarantined', reason: 'SAFETY_REVIEW' };
  }
  if (status === 'FAILED') {
    return { displayState: 'error', reason: 'UPLOAD_FAILED' };
  }
  if (status === 'UPLOADING' || status === 'SCANNING') {
    return { displayState: 'pending', reason: status };
  }

  if (!safeMode.enabled) {
    return { displayState: 'visible', reason: 'SAFE_MODE_OFF' };
  }
  if (nsfwBand <= safeMode.bandMax) {
    return { displayState: 'visible', reason: 'WITHIN_THRESHOLD' };
  }
  if (nsfwBand === safeMode.bandMax + 1) {
    return { displayState: 'blurred', reason: 'SOFT_EXCEEDANCE' };
  }
  return { displayState: 'blocked', reason: 'HARD_EXCEEDANCE' };
}

/**
 * Produces a Safe-Mode filtered message body (placeholder when blocked).
 * @param {string} body
 * @param {{ safeMode?: { enabled: boolean; bandMax: number }; nsfwBand?: number }} options
 */
export function filterMessageBody(body, options = {}) {
  const safeMode = options.safeMode ?? { enabled: true, bandMax: DEFAULT_SAFEMODE_BAND };
  const nsfwBand = Number.isInteger(options.nsfwBand) ? options.nsfwBand : 0;
  if (!safeMode.enabled || nsfwBand <= safeMode.bandMax) {
    return { body, redacted: false };
  }
  return {
    body: '[Safe-Mode protected message]',
    redacted: true
  };
}

/**
 * Produces analytics metadata for Safe-Mode events.
 * @param {{ displayState: string; reason?: string }} display
 * @param {{ threadId?: string; messageId?: string; attachmentId?: string }} context
 */
export function createSafeModeEvent(display, context = {}) {
  return {
    type: 'messaging.safe_mode.render',
    payload: {
      displayState: display.displayState,
      reason: display.reason,
      threadId: context.threadId ?? null,
      messageId: context.messageId ?? null,
      attachmentId: context.attachmentId ?? null,
      timestamp: new Date().toISOString()
    }
  };
}
