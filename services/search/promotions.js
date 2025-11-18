/**
 * Allocate promotion slots (featured + boost) with density caps and invalid-click filtering.
 * @param {import('./types').PromotionCandidate[]} candidates
 * @param {import('./types').PromotionConfig} config
 * @param {{nowEpoch?: number; invalidClicks?: import('./types').InvalidClickEvent[]}} options
 * @returns {import('./types').PromotionAllocationResult & {placements: Array<{id: string; slot: string; position: number}>}}
 */
export function allocatePromotions(candidates, config, options = {}) {
  const nowEpoch = options.nowEpoch ?? Math.floor(Date.now() / 1000);
  const invalidClickMap = new Map();
  for (const event of options.invalidClicks ?? []) {
    if (!event.documentId || typeof event.occurredAt !== 'number') {
      continue;
    }
    const ageSeconds = nowEpoch - event.occurredAt;
    if (ageSeconds <= config.invalidClickWindowSeconds) {
      invalidClickMap.set(event.documentId, ageSeconds);
    }
  }

  const invalidClickFiltered = [];
  const validCandidates = [];
  for (const candidate of candidates) {
    if (invalidClickMap.has(candidate.id)) {
      invalidClickFiltered.push(candidate.id);
      continue;
    }
    validCandidates.push(candidate);
  }

  const featuredCandidates = validCandidates
    .filter((c) => c.slot === 'FEATURED')
    .sort((a, b) => b.orderScore - a.orderScore);
  const boostCandidates = validCandidates
    .filter((c) => c.slot === 'BOOST')
    .sort((a, b) => b.orderScore - a.orderScore);

  const placements = [];
  const densityViolations = [];

  // Place featured slots first, respecting density caps.
  let featuredPlaced = 0;
  let featuredAboveFold = 0;
  const maxPositionWindow = config.maxFeaturedInTopN;
  let nextPosition = 1;

  for (const candidate of featuredCandidates) {
    if (featuredPlaced >= config.featuredSlots) {
      break;
    }
    if (featuredPlaced >= maxPositionWindow) {
      densityViolations.push(candidate.id);
      continue;
    }
    if (nextPosition <= 5 && featuredAboveFold >= config.featuredMaxAboveFold) {
      densityViolations.push(candidate.id);
      continue;
    }
    placements.push({
      id: candidate.id,
      slot: candidate.slot,
      position: nextPosition
    });
    featuredPlaced += 1;
    if (nextPosition <= 5) {
      featuredAboveFold += 1;
    }
    nextPosition += 1;
  }

  // Ensure next position accounts for any gap left by skipped candidates.
  if (placements.length > 0) {
    nextPosition = Math.max(nextPosition, placements[placements.length - 1].position + 1);
  }

  // Schedule boost placements starting after configured offset.
  let boostPosition = Math.max(config.boostStartPosition, nextPosition);
  let boostIndex = 0;
  for (const candidate of boostCandidates) {
    // Avoid collisions with existing placements.
    while (placements.some((p) => p.position === boostPosition)) {
      boostPosition += 1;
    }
    placements.push({
      id: candidate.id,
      slot: candidate.slot,
      position: boostPosition
    });
    boostIndex += 1;
    boostPosition += Math.max(config.boostFrequency, 1) + 1;
  }

  placements.sort((a, b) => a.position - b.position);
  const ordered = placements.map((p) => p.id);

  return {
    ordered,
    invalidClickFiltered,
    densityViolations,
    placements
  };
}
