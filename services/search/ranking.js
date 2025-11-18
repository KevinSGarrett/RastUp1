// ESM module implementing ranking logic for search documents.
// The companion TypeScript file re-exports these functions with strong types.

const DEFAULT_THRESHOLDS = {
  disputeRate30d: 0.05,
  cancelRate90d: 0.08,
  lateDeliveryRate90d: 0.1
};

const EPSILON = 1e-6;

/**
 * Clamp a value within [min, max].
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute a proximity score using a Gaussian decay where score=1 at distance 0
 * and approaches 0 as the distance exceeds the query radius.
 */
function computeProximityScore(distanceKm, radiusKm) {
  if (typeof distanceKm !== 'number' || typeof radiusKm !== 'number' || radiusKm <= 0) {
    return 0;
  }
  const normalized = distanceKm / radiusKm;
  if (normalized >= 1) {
    return 0;
  }
  const variance = 0.25; // moderately steep decay
  return Math.exp(-Math.pow(normalized, 2) / (2 * variance));
}

/**
 * Compute a price-fit score given the query budget.
 */
function computePriceFitScore(price, queryBudgetCents) {
  if (typeof price !== 'number' || !queryBudgetCents) {
    return 1;
  }
  if (price <= 0) {
    return 0.5;
  }
  const diff = Math.abs(price - queryBudgetCents);
  const tolerance = Math.max(queryBudgetCents * 0.5, 10_00); // 50% tolerance or $10
  return clamp(1 - diff / tolerance, 0, 1);
}

/**
 * Compute a recency score using exponential decay (half-life 30 days).
 */
function computeRecencyScore(updatedAtEpoch, nowEpoch) {
  if (!updatedAtEpoch || !nowEpoch) {
    return 0.5;
  }
  const secondsElapsed = Math.max(nowEpoch - updatedAtEpoch, 0);
  const halfLifeSeconds = 30 * 24 * 3600;
  const decay = Math.pow(0.5, secondsElapsed / halfLifeSeconds);
  return clamp(decay, 0, 1);
}

function computePolicyPenalty(policySignals) {
  if (!policySignals) {
    return 0;
  }
  let penalty = 0;
  if (policySignals.disputeRate30d && policySignals.disputeRate30d > DEFAULT_THRESHOLDS.disputeRate30d) {
    penalty += Math.min((policySignals.disputeRate30d - DEFAULT_THRESHOLDS.disputeRate30d) * 4, 1);
  }
  if (policySignals.cancelRate90d && policySignals.cancelRate90d > DEFAULT_THRESHOLDS.cancelRate90d) {
    penalty += Math.min((policySignals.cancelRate90d - DEFAULT_THRESHOLDS.cancelRate90d) * 3, 1);
  }
  if (policySignals.lateDeliveryRate90d && policySignals.lateDeliveryRate90d > DEFAULT_THRESHOLDS.lateDeliveryRate90d) {
    penalty += Math.min((policySignals.lateDeliveryRate90d - DEFAULT_THRESHOLDS.lateDeliveryRate90d) * 2, 1);
  }
  return clamp(penalty, 0, 1);
}

/**
 * Computes a blended rank score for a single document.
 * @param {import('./types').SearchDocument} document
 * @param {{
 *  textMatch?: number;
 *  distanceKm?: number;
 *  reputationScore?: number;
 *  availabilityMatch?: number;
 *  verificationBoost?: number;
 * }} signals
 * @param {import('./types').RankingContext} context
 */
export function computeRankScore(document, signals, context) {
  const weights = context.weights;

  const textMatch = clamp(signals.textMatch ?? 0, 0, 1);
  const textComponent = textMatch * weights.text;

  const proximity = computeProximityScore(signals.distanceKm ?? null, context.geoPreference?.radiusKm);
  const proximityComponent = proximity * weights.proximity;

  const reputationBase = clamp(signals.reputationScore ?? (document.ratingAvg ?? 0) / 5, 0, 1);
  const reputationComponent = reputationBase * weights.reputation;

  const verificationBase = signals.verificationBoost ?? (document.verifiedId ? 1 : 0) + (document.verifiedBg ? 0.5 : 0);
  const verificationComponent = clamp(verificationBase, 0, 1) * weights.verification;

  const priceFitBase = computePriceFitScore(document.priceFromCents ?? null, context.queryBudgetCents);
  const priceComponent = priceFitBase * weights.priceFit;

  const availabilityBase = signals.availabilityMatch ?? document.availabilityScore ?? 0;
  const availabilityComponent = clamp(availabilityBase, 0, 1) * weights.availability;

  const recencyBase = computeRecencyScore(document.updatedAtEpoch, context.nowEpoch);
  const recencyComponent = recencyBase * weights.recency;

  const policyPenalty = computePolicyPenalty(document.policySignals);

  const baseScore =
    textComponent +
    proximityComponent +
    reputationComponent +
    verificationComponent +
    priceComponent +
    availabilityComponent +
    recencyComponent -
    policyPenalty;

  return {
    score: Number(baseScore.toFixed(6)),
    breakdown: {
      textMatch: Number(textComponent.toFixed(6)),
      proximity: Number(proximityComponent.toFixed(6)),
      reputation: Number(reputationComponent.toFixed(6)),
      verification: Number(verificationComponent.toFixed(6)),
      priceFit: Number(priceComponent.toFixed(6)),
      availability: Number(availabilityComponent.toFixed(6)),
      recency: Number(recencyComponent.toFixed(6)),
      fairnessPenalty: 0,
      policyPenalty: Number(policyPenalty.toFixed(6))
    }
  };
}

/**
 * Applies diversity and fairness constraints to a ranked result list.
 * @param {Array<{document: import('./types').SearchDocument; score: number; breakdown: any}>} scoredDocs
 * @param {import('./types').RankingContext} context
 * @returns {{selected: Array<{document: any; score: number; breakdown: any}>; dropped: Array<{document: any; reason: string}>}}
 */
export function applyFairnessConstraints(scoredDocs, context) {
  const safeModeFiltered = scoredDocs.filter((entry) => entry.document.safeModeBandMax <= context.allowSafeModeBand);

  const sorted = [...safeModeFiltered].sort((a, b) => b.score - a.score);

  const ownerCounts = new Map();
  const selected = [];
  const dropped = [];
  const newSellerSlots = Math.max(context.newSellerFloor.slots, 0);
  const newSellerMinCount = Math.max(context.newSellerFloor.minRatingCount, 1);
  const windowSize = Math.max(context.ownerDiversity.window, 1);

  const isNewSeller = (doc) => {
    const ratingCount = doc.ratingCount ?? 0;
    if (ratingCount < newSellerMinCount) {
      return true;
    }
    return (doc.newSellerScore ?? 0) > 0.5;
  };

  const mandatedNewSellers = [];
  for (const entry of sorted) {
    if (mandatedNewSellers.length >= newSellerSlots) {
      break;
    }
    if (isNewSeller(entry.document)) {
      mandatedNewSellers.push(entry);
    }
  }

  const alreadyMandatedIds = new Set(mandatedNewSellers.map((entry) => entry.document.id));

  const remainder = sorted.filter((entry) => !alreadyMandatedIds.has(entry.document.id));

  function trySelect(entry, reasonIfDropped) {
    const ownerId = entry.document.ownerGroupId ?? entry.document.ownerId;
    const currentCount = ownerCounts.get(ownerId) ?? 0;
    if (currentCount >= context.ownerDiversity.maxPerOwner) {
      const penalized = {
        ...entry,
        score: Number(Math.max(entry.score - 0.15, 0).toFixed(6)),
        breakdown: {
          ...entry.breakdown,
          fairnessPenalty: Number((entry.breakdown.fairnessPenalty ?? 0 + 0.15).toFixed(6))
        }
      };
      dropped.push({ document: penalized.document, reason: reasonIfDropped });
      return;
    }
    selected.push(entry);
    ownerCounts.set(ownerId, currentCount + 1);
  }

  for (const mandated of mandatedNewSellers) {
    if (selected.length >= windowSize) {
      break;
    }
    trySelect(mandated, 'owner_cap_new_seller');
  }

  for (const entry of remainder) {
    if (selected.length >= windowSize) {
      break;
    }
    trySelect(entry, 'owner_cap');
  }

  return {
    selected,
    dropped,
    newSellerCount: selected.filter((entry) => isNewSeller(entry.document)).length
  };
}

/**
 * Utility to rank documents end-to-end given a set of metric signals keyed by document id.
 * @param {import('./types').SearchDocument[]} documents
 * @param {Record<string, any>} signalMap
 * @param {import('./types').RankingContext} context
 */
export function rankDocuments(documents, signalMap, context) {
  const scored = documents.map((doc) => {
    const metrics = signalMap[doc.id] ?? {};
    const { score, breakdown } = computeRankScore(doc, metrics, context);
    return { document: doc, score, breakdown };
  });
  const fairness = applyFairnessConstraints(scored, context);
  const ordered = [...fairness.selected].sort((a, b) => b.score - a.score);
  return {
    results: ordered,
    dropped: fairness.dropped
  };
}

/**
 * Simple helper that ensures a minimum share of organic results remains when promotions exist.
 * @param {number} organicCount
 * @param {number} promotedCount
 * @param {number} minOrganicShare (0-1)
 */
export function enforceOrganicShare(organicCount, promotedCount, minOrganicShare = 0.8) {
  const total = organicCount + promotedCount;
  if (total === 0) {
    return true;
  }
  const share = organicCount / total;
  return share + EPSILON >= minOrganicShare;
}

export const __testables = {
  computeProximityScore,
  computePriceFitScore,
  computeRecencyScore,
  computePolicyPenalty
};
