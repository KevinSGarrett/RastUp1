const PROVIDER_CONFIG = Object.freeze({
  weights: {
    identity: 18,
    roles: 10,
    portfolio: 22,
    pricing: 16,
    availability: 14,
    verification: 12,
    payout: 8,
  },
  publishThreshold: 70,
  instantBookThreshold: 85,
  searchBoostThreshold: 90,
});

const HOST_CONFIG = Object.freeze({
  weights: {
    basics: 20,
    policies: 15,
    pricing: 18,
    availability: 17,
    verification: 18,
    insurance: 12,
  },
  publishThreshold: 65,
  instantBookThreshold: 80,
  searchBoostThreshold: 88,
});

/**
 * Evaluates completeness for provider and/or host onboarding.
 * @param {object} payload
 * @param {'provider'|'host'|'dual'} payload.role
 * @param {object} [payload.provider]
 * @param {object} [payload.host]
 * @param {object} [options]
 */
export function evaluateCompleteness(payload, options = {}) {
  const role = payload?.role ?? 'provider';
  if (role === 'dual') {
    const provider = evaluateProvider(payload.provider ?? {}, options.providerConfig);
    const host = evaluateHost(payload.host ?? {}, options.hostConfig);
    const score = Math.round((provider.score + host.score) / 2);
    return {
      role: 'dual',
      score,
      breakdown: {
        provider: provider.breakdown,
        host: host.breakdown,
      },
      blocks: [...provider.blocks, ...host.blocks],
      eligible: {
        publish: provider.eligible.publish && host.eligible.publish,
        instantBook: provider.eligible.instantBook && host.eligible.instantBook,
        searchBoost: provider.eligible.searchBoost && host.eligible.searchBoost,
      },
    };
  }

  if (role === 'host') {
    return evaluateHost(payload.host ?? payload, options.hostConfig);
  }

  return evaluateProvider(payload.provider ?? payload, options.providerConfig);
}

function evaluateProvider(data = {}, config = PROVIDER_CONFIG) {
  const weights = config.weights ?? PROVIDER_CONFIG.weights;
  const breakdown = {};
  let score = 0;
  const blocks = [];

  const identityComplete = Boolean(data.identity?.legalName && data.identity?.displayName && data.identity?.location);
  breakdown.identity = identityComplete ? weights.identity : 0;
  score += breakdown.identity;
  if (!identityComplete) blocks.push('identity_incomplete');

  const rolesComplete = Array.isArray(data.roles) && data.roles.length > 0;
  breakdown.roles = rolesComplete ? weights.roles : 0;
  score += breakdown.roles;
  if (!rolesComplete) blocks.push('roles_missing');

  const portfolioApproved =
    (data.portfolio?.approvedCount ?? 0) >= (data.portfolio?.minimumApproved ?? 6);
  const sfwReady = Boolean(data.portfolio?.sfwCompliant !== false);
  breakdown.portfolio = portfolioApproved && sfwReady ? weights.portfolio : portfolioApproved ? weights.portfolio * 0.6 : 0;
  score += breakdown.portfolio;
  if (!portfolioApproved) blocks.push('portfolio_insufficient');
  if (!sfwReady) blocks.push('portfolio_requires_sfw');

  const pricingConfigured = Boolean(data.pricing?.packages?.length || data.pricing?.hourlyRate);
  breakdown.pricing = pricingConfigured ? weights.pricing : 0;
  score += breakdown.pricing;
  if (!pricingConfigured) blocks.push('pricing_missing');

  const availabilityReady = Boolean(
    data.availability?.weeklyTemplate && data.availability?.timezone && data.availability?.meetsMinHours,
  );
  breakdown.availability = availabilityReady ? weights.availability : 0;
  score += breakdown.availability;
  if (!availabilityReady) blocks.push('availability_missing');

  const verificationStatus = data.verification?.status ?? 'draft';
  const verificationComplete = ['submitted', 'verified'].includes(verificationStatus);
  breakdown.verification = verificationComplete ? weights.verification : 0;
  score += breakdown.verification;
  if (!verificationComplete) blocks.push('verification_pending');

  const payoutConfigured = Boolean(data.payout?.status === 'ready');
  breakdown.payout = payoutConfigured ? weights.payout : 0;
  score += breakdown.payout;
  if (!payoutConfigured) blocks.push('payout_required');

  const publishEligible =
    score >= (config.publishThreshold ?? PROVIDER_CONFIG.publishThreshold) &&
    verificationComplete &&
    sfwReady &&
    portfolioApproved;

  const instantBookEligible =
    score >= (config.instantBookThreshold ?? PROVIDER_CONFIG.instantBookThreshold) &&
    payoutConfigured &&
    availabilityReady &&
    verificationComplete;

  const searchBoostEligible =
    score >= (config.searchBoostThreshold ?? PROVIDER_CONFIG.searchBoostThreshold) &&
    portfolioApproved &&
    verificationComplete;

  return {
    role: 'provider',
    score: Math.round(score),
    breakdown,
    blocks: dedupe(blocks),
    eligible: {
      publish: publishEligible,
      instantBook: instantBookEligible,
      searchBoost: searchBoostEligible,
    },
  };
}

function evaluateHost(data = {}, config = HOST_CONFIG) {
  const weights = config.weights ?? HOST_CONFIG.weights;
  const breakdown = {};
  let score = 0;
  const blocks = [];

  const basicsComplete = Boolean(data.basics?.name && data.basics?.city && data.basics?.capacity);
  const mapVerified = Boolean(data.basics?.mapPinVerified);
  breakdown.basics = basicsComplete && mapVerified ? weights.basics : basicsComplete ? weights.basics * 0.7 : 0;
  score += breakdown.basics;
  if (!basicsComplete) blocks.push('studio_basics_missing');
  if (!mapVerified) blocks.push('map_pin_unverified');

  const policiesComplete = Boolean(data.policies?.cancellation && data.policies?.reschedule);
  breakdown.policies = policiesComplete ? weights.policies : 0;
  score += breakdown.policies;
  if (!policiesComplete) blocks.push('policies_missing');

  const pricingComplete = Boolean(data.pricing?.hourlyMin && data.pricing?.hourlyMax);
  const depositConfigured = Boolean(data.pricing?.depositPolicy === 'configured');
  breakdown.pricing = pricingComplete ? weights.pricing : weights.pricing * 0.5;
  score += breakdown.pricing;
  if (!pricingComplete) blocks.push('pricing_range_missing');
  if (!depositConfigured) blocks.push('deposit_policy_missing');

  const availabilityReady = Boolean(data.availability?.calendarSynced && data.availability?.buffersConfigured);
  breakdown.availability = availabilityReady ? weights.availability : 0;
  score += breakdown.availability;
  if (!availabilityReady) blocks.push('availability_missing');

  const verificationStatus = data.verification?.status ?? 'draft';
  const verificationComplete = ['submitted', 'verified'].includes(verificationStatus);
  breakdown.verification = verificationComplete ? weights.verification : 0;
  score += breakdown.verification;
  if (!verificationComplete) blocks.push('verification_pending');

  const insuranceValid = Boolean(data.insurance?.status === 'approved');
  breakdown.insurance = insuranceValid ? weights.insurance : 0;
  score += breakdown.insurance;
  if (!insuranceValid) blocks.push('insurance_required');

  const publishEligible =
    score >= (config.publishThreshold ?? HOST_CONFIG.publishThreshold) &&
    basicsComplete &&
    verificationComplete &&
    depositConfigured;

  const instantBookEligible =
    score >= (config.instantBookThreshold ?? HOST_CONFIG.instantBookThreshold) &&
    verificationComplete &&
    depositConfigured &&
    availabilityReady;

  const searchBoostEligible =
    score >= (config.searchBoostThreshold ?? HOST_CONFIG.searchBoostThreshold) &&
    insuranceValid &&
    verificationComplete;

  return {
    role: 'host',
    score: Math.round(score),
    breakdown,
    blocks: dedupe(blocks),
    eligible: {
      publish: publishEligible,
      instantBook: instantBookEligible,
      searchBoost: searchBoostEligible,
    },
  };
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

export const COMPLETENESS_DEFAULTS = {
  provider: PROVIDER_CONFIG,
  host: HOST_CONFIG,
};
