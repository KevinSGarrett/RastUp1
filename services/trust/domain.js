const DEFAULT_RISK_WEIGHTS = {
  disputesOpened: 10,
  refundsAsked: 8,
  cancellations: 5,
  lateDelivery: 4,
  chargeFailures: 6,
  badClicks: 3
};

const DEFAULT_THRESHOLDS = {
  instantBook: 60,
  promotions: 70,
  manualReview: 30,
  safeModeOverride: 80
};

const TWO_PERSON_ACTIONS = new Set(['override_safe_mode', 'trust_badge_revoke', 'adverse_action_close']);

function clampScore(value) {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function computeRiskScore(metrics = {}, weights = DEFAULT_RISK_WEIGHTS) {
  if (typeof metrics.score === 'number') {
    return clampScore(metrics.score);
  }

  let score = 100;
  Object.entries(weights).forEach(([key, weight]) => {
    const count = typeof metrics[key] === 'number' ? metrics[key] : 0;
    score -= count * weight;
  });
  return clampScore(score);
}

export function evaluateTrustStatus({ idv, bg, socials = [], riskMetrics = {} } = {}) {
  const idVerified = Boolean(idv && idv.status === 'passed' && idv.age_verified !== false && idv.ageVerified !== false);
  const ageVerified = Boolean(idv && (idv.age_verified === true || idv.ageVerified === true));

  const trustedPro =
    Boolean(bg && bg.status === 'clear') && !['consider', 'suspended', 'disputed'].includes(bg?.adjudication ?? '');

  const socialVerified = Array.isArray(socials) && socials.some((entry) => entry?.verified === true);

  const riskScore = computeRiskScore(riskMetrics);

  const badges = deriveTrustBadges({ idVerified, trustedPro, socialVerified });

  return {
    idVerified,
    ageVerified,
    trustedPro,
    socialVerified,
    riskScore,
    badges,
    lastIdvAt: idv?.updated_at ?? idv?.updatedAt,
    lastBgAt: bg?.updated_at ?? bg?.updatedAt
  };
}

export function deriveTrustBadges({ idVerified, trustedPro, socialVerified }) {
  const badges = [];
  if (idVerified) badges.push('id_verified');
  if (trustedPro) badges.push('trusted_pro');
  if (socialVerified) badges.push('social_verified');
  return badges;
}

export function computeEligibilityGates(trustStatus, thresholds = {}) {
  const merged = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds
  };

  const canInstantBook = trustStatus.idVerified && trustStatus.riskScore >= merged.instantBook;
  const promotionEligible =
    (trustStatus.trustedPro || trustStatus.idVerified) && trustStatus.riskScore >= merged.promotions;
  const requiresManualReview = trustStatus.riskScore < merged.manualReview || !trustStatus.idVerified;
  const safeModeOverrideAllowed = trustStatus.idVerified && trustStatus.riskScore >= merged.safeModeOverride;

  return {
    canInstantBook,
    promotionEligible,
    requiresManualReview,
    safeModeOverrideAllowed
  };
}

export function requiresTwoPersonApproval(context = {}) {
  if (context.severity === 'high') {
    return true;
  }
  if (context.severity === 'medium' && context.action === 'override_safe_mode') {
    return true;
  }
  return TWO_PERSON_ACTIONS.has(context.action);
}

export function nextRecertificationAt(status, kind, rules = {}) {
  const sourceTimestamp = status?.updated_at ?? status?.updatedAt;
  if (!sourceTimestamp) {
    return null;
  }
  const date = new Date(sourceTimestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (kind === 'idv') {
    const months = rules.idvMonths ?? 24;
    date.setMonth(date.getMonth() + months);
    return date.toISOString();
  }

  if (kind === 'bg') {
    const months = rules.bgMonths ?? 12;
    date.setMonth(date.getMonth() + months);
    return date.toISOString();
  }

  if (kind === 'social') {
    const days = rules.socialDays ?? 30;
    date.setDate(date.getDate() + days);
    return date.toISOString();
  }

  return null;
}

export { DEFAULT_RISK_WEIGHTS, DEFAULT_THRESHOLDS };
