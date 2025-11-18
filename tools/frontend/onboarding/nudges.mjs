const DEFAULT_NUDGES = {
  identity_incomplete: {
    id: 'complete_identity',
    message: 'Add your legal name and city so clients know who they are booking.',
    cta: 'Open identity step',
    targetStep: 'identity',
    priority: 90,
  },
  roles_missing: {
    id: 'select_roles',
    message: 'Choose at least one role so we can place you in the right searches.',
    cta: 'Select roles & tags',
    targetStep: 'roles',
    priority: 75,
  },
  portfolio_insufficient: {
    id: 'upload_portfolio',
    message: 'Add more approved portfolio shots to unlock search boosts.',
    cta: 'Upload portfolio',
    targetStep: 'portfolio',
    priority: 95,
  },
  portfolio_requires_sfw: {
    id: 'resolve_sfw',
    message: 'Some media needs Safe-Mode versions before you can publish.',
    cta: 'Review flagged media',
    targetStep: 'portfolio',
    priority: 92,
  },
  pricing_missing: {
    id: 'set_pricing',
    message: 'Add pricing or packages so clients can book you instantly.',
    cta: 'Add pricing',
    targetStep: 'pricing',
    priority: 80,
  },
  availability_missing: {
    id: 'sync_calendar',
    message: 'Sync your calendar and set availability to appear in Instant Book results.',
    cta: 'Configure availability',
    targetStep: 'availability',
    priority: 70,
  },
  verification_pending: {
    id: 'submit_verification',
    message: 'Submit your verification details to build trust and publish.',
    cta: 'Go to verification',
    targetStep: 'verification',
    priority: 88,
  },
  payout_required: {
    id: 'add_payout',
    message: 'Add a payout method so we can release funds to you.',
    cta: 'Add payout details',
    targetStep: 'payout',
    priority: 85,
  },
  studio_basics_missing: {
    id: 'complete_studio_basics',
    message: 'Add studio basics (name, city, capacity) to show up in studio searches.',
    cta: 'Finish studio basics',
    targetStep: 'basics',
    priority: 90,
  },
  map_pin_unverified: {
    id: 'verify_map_pin',
    message: 'Verify your map pin for accurate location previews.',
    cta: 'Verify map location',
    targetStep: 'basics',
    priority: 78,
  },
  policies_missing: {
    id: 'add_policies',
    message: 'Define cancellation and reschedule policies to set expectations.',
    cta: 'Add studio policies',
    targetStep: 'policies',
    priority: 76,
  },
  deposit_policy_missing: {
    id: 'configure_deposit',
    message: 'Set a deposit policy to enable Instant Book for studios.',
    cta: 'Configure deposit policy',
    targetStep: 'pricing',
    priority: 82,
  },
  insurance_required: {
    id: 'upload_insurance',
    message: 'Upload insurance documents to complete verification.',
    cta: 'Add insurance proof',
    targetStep: 'verification',
    priority: 84,
  },
};

/**
 * Generates prioritized nudges based on completeness gaps.
 * @param {object} context
 * @param {object} context.completeness - result from evaluateCompleteness
 * @param {number} [context.maxNudges=3]
 * @param {object} [overrides]
 * @returns {Array<{id: string, message: string, cta: string, targetStep: string, priority: number}>}
 */
export function generateNudges(context, overrides = {}) {
  if (!context?.completeness) return [];
  const blocks = context.completeness.blocks ?? [];
  const registry = { ...DEFAULT_NUDGES, ...(overrides.registry ?? {}) };
  const max = context.maxNudges ?? overrides.maxNudges ?? 3;

  const nudges = blocks
    .map((block) => registry[block])
    .filter(Boolean)
    .map((nudge) => ({
      ...nudge,
      priority: nudge.priority ?? 50,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max);

  if (nudges.length === 0 && context.completeness.score < 100) {
    nudges.push({
      id: 'share_profile',
      message: 'Keep optimising your profile to reach 100% completeness.',
      cta: 'Review checklist',
      targetStep: 'review',
      priority: 40,
    });
  }

  return nudges;
}

export const NUDGE_DEFAULTS = DEFAULT_NUDGES;
