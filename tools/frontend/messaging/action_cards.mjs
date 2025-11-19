const DEFAULT_ACTION_CARD_DEFINITIONS = Object.freeze({
  RESCHEDULE: {
    category: 'booking.schedule',
    states: {
      PENDING: {
        accept: 'ACCEPTED',
        decline: 'DECLINED',
        expire: 'EXPIRED'
      }
    },
    terminal: ['ACCEPTED', 'DECLINED', 'EXPIRED']
  },
  REQUEST_EXTRA: {
    category: 'booking.extras',
    states: {
      PENDING: {
        approve: 'PAID',
        decline: 'DECLINED',
        fail: 'FAILED'
      },
      PAID: {
        refund: 'REFUNDED'
      }
    },
    terminal: ['PAID', 'DECLINED', 'FAILED', 'REFUNDED']
  },
  OVERTIME_START: {
    category: 'booking.overtime',
    states: {
      PENDING: {
        confirm: 'RUNNING',
        cancel: 'CANCELLED'
      },
      RUNNING: {
        stop: 'STOPPED'
      }
    },
    terminal: ['STOPPED', 'CANCELLED']
  },
  OVERTIME_STOP: {
    category: 'booking.overtime',
    states: {
      PENDING: {
        confirm: 'STOPPED',
        fail: 'FAILED'
      }
    },
    terminal: ['STOPPED', 'FAILED']
  },
  DELIVERABLE_PROOF: {
    category: 'deliverables.proof',
    states: {
      SUBMITTED: {
        approve: 'APPROVED',
        request_revisions: 'REVISION_REQUESTED'
      },
      REVISION_REQUESTED: {
        resubmit: 'SUBMITTED',
        cancel: 'CANCELLED'
      }
    },
    terminal: ['APPROVED', 'CANCELLED']
  },
  DELIVERABLE_FINAL: {
    category: 'deliverables.final',
    states: {
      SUBMITTED: {
        acknowledge: 'ACCEPTED',
        request_revisions: 'REVISION_REQUESTED'
      },
      REVISION_REQUESTED: {
        resubmit: 'SUBMITTED',
        cancel: 'CANCELLED'
      }
    },
    terminal: ['ACCEPTED', 'CANCELLED']
  },
  CANCEL_REQUEST: {
    category: 'booking.cancellation',
    states: {
      PENDING: {
        approve: 'APPROVED',
        decline: 'DECLINED',
        escalate: 'ESCALATED'
      },
      ESCALATED: {
        resolve: 'RESOLVED'
      }
    },
    terminal: ['APPROVED', 'DECLINED', 'RESOLVED']
  },
  REFUND_REQUEST: {
    category: 'booking.refund',
    states: {
      PENDING: {
        approve: 'APPROVED',
        decline: 'DECLINED',
        escalate: 'ESCALATED'
      },
      APPROVED: {
        settle: 'SETTLED'
      },
      ESCALATED: {
        resolve: 'RESOLVED'
      }
    },
    terminal: ['DECLINED', 'SETTLED', 'RESOLVED']
  },
  ACCEPTANCE_ACK: {
    category: 'booking.completion',
    states: {
      PENDING: {
        acknowledge: 'COMPLETED'
      }
    },
    terminal: ['COMPLETED']
  },
  DEPOSIT_CLAIM_OPEN: {
    category: 'finance.deposit_claim',
    states: {
      PENDING: {
        approve: 'APPROVED',
        deny: 'DENIED',
        escalate: 'ESCALATED'
      },
      ESCALATED: {
        resolve: 'RESOLVED'
      }
    },
    terminal: ['APPROVED', 'DENIED', 'RESOLVED']
  },
  DISPUTE_OPEN: {
    category: 'finance.dispute',
    states: {
      OPEN: {
        settle: 'SETTLED',
        escalate: 'ESCALATED'
      },
      ESCALATED: {
        resolve: 'RESOLVED'
      }
    },
    terminal: ['SETTLED', 'RESOLVED']
  }
});

/**
 * Returns the configured definition for a given action card type.
 * @param {string} type
 * @param {{ definitions?: Record<string, any> }} [options]
 */
export function getActionCardDefinition(type, options = {}) {
  const definitions = options.definitions ?? DEFAULT_ACTION_CARD_DEFINITIONS;
  return definitions?.[type] ?? null;
}

function coerceIntentKey(intent) {
  return typeof intent === 'string' ? intent.toLowerCase() : intent;
}

function normalizeTransitionsFromCard(card) {
  if (!Array.isArray(card?.allowedTransitions)) {
    return null;
  }
  return card.allowedTransitions
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        return { intent: entry, toState: entry };
      }
      const intent = entry.intent ?? entry.action ?? entry.name ?? entry.type;
      const toState = entry.toState ?? entry.state ?? entry.targetState;
      if (!intent || !toState) {
        return null;
      }
      return { intent, toState };
    })
    .filter(Boolean);
}

/**
 * Calculates allowed transitions for an action card.
 * Falls back to default definitions when card does not specify `allowedTransitions`.
 * @param {{ type: string; state: string; allowedTransitions?: Array<any> }} card
 * @param {{ definitions?: Record<string, any> }} [options]
 * @returns {Array<{ intent: string; toState: string }>}
 */
export function getAllowedTransitions(card, options = {}) {
  if (!card) {
    return [];
  }

  const cardDefined = normalizeTransitionsFromCard(card);
  if (cardDefined) {
    return cardDefined;
  }

  const definition = getActionCardDefinition(card.type, options);
  if (!definition) {
    return [];
  }

  const stateConfig = definition.states?.[card.state];
  if (!stateConfig) {
    return [];
  }

  return Object.entries(stateConfig).map(([intent, toState]) => ({
    intent,
    toState
  }));
}

/**
 * Performs a client-side transition on an action card, returning the new card and audit event.
 * @param {{
 *   actionId?: string;
 *   type: string;
 *   state: string;
 *   version?: number;
 *   updatedAt?: string;
 *   payload?: Record<string, any>;
 *   allowedTransitions?: Array<any>;
 *   metadata?: Record<string, any>;
 * }} card
 * @param {string} intent
 * @param {{
 *   now?: number;
 *   updatedAt?: string;
 *   version?: number;
 *   versionIncrement?: number;
 *   metadata?: Record<string, any>;
 *   payloadPatch?: Record<string, any>;
 *   mutatePayload?: (payload: Record<string, any>, nextCard: any) => Record<string, any>;
 *   actorUserId?: string|null;
 *   threadId?: string|null;
 *   auditMetadata?: Record<string, any>|null;
 *   emitAudit?: boolean;
 *   definitions?: Record<string, any>;
 * }} [options]
 */
export function transitionActionCard(card, intent, options = {}) {
  if (!card) {
    throw new Error('transitionActionCard requires a card');
  }
  if (!intent) {
    throw new Error('transitionActionCard requires an intent');
  }

  const transitions = getAllowedTransitions(card, options);
  const normalizedIntent = coerceIntentKey(intent);
  const match = transitions.find(
    (candidate) =>
      coerceIntentKey(candidate.intent) === normalizedIntent ||
      candidate.intent === intent ||
      candidate.intent === normalizedIntent
  );

  if (!match) {
    const type = card.type ?? 'UNKNOWN';
    const state = card.state ?? 'UNKNOWN';
    throw new Error(`Invalid transition "${intent}" for ${type}:${state}`);
  }

  const now = options.now ?? Date.now();
  const updatedAt = options.updatedAt ?? new Date(now).toISOString();
  let version;
  if (typeof options.version === 'number') {
    version = options.version;
  } else {
    const increment = typeof options.versionIncrement === 'number' ? options.versionIncrement : 1;
    version = (card.version ?? 0) + increment;
  }

  const nextCard = {
    ...card,
    state: match.toState,
    version,
    updatedAt,
    lastIntent: intent,
    metadata: { ...(card.metadata ?? {}), ...(options.metadata ?? {}) }
  };

  if (typeof options.mutatePayload === 'function') {
    nextCard.payload = options.mutatePayload({ ...(card.payload ?? {}) }, nextCard);
  } else if (options.payloadPatch) {
    nextCard.payload = { ...(card.payload ?? {}), ...options.payloadPatch };
  } else if (card.payload) {
    nextCard.payload = { ...card.payload };
  }

  const auditEvent =
    options.emitAudit === false
      ? null
      : {
          type: 'messaging.action_card.transition',
          payload: {
            actionId: card.actionId ?? null,
            actionType: card.type ?? null,
            fromState: card.state ?? null,
            toState: match.toState,
            intent,
            version,
            actorUserId: options.actorUserId ?? null,
            threadId: options.threadId ?? null,
            timestamp: updatedAt,
            metadata: options.auditMetadata ?? null,
            category: getActionCardDefinition(card.type, options)?.category ?? null
          }
        };

  return { card: nextCard, auditEvent };
}

/**
 * Indicates whether the action card is in a terminal (no-op) state.
 * @param {{ type: string; state: string }} card
 * @param {{ definitions?: Record<string, any> }} [options]
 */
export function isTerminalState(card, options = {}) {
  if (!card) {
    return false;
  }
  const definition = getActionCardDefinition(card.type, options);
  if (!definition) {
    return false;
  }
  const terminalStates = definition.terminal ?? [];
  return terminalStates.includes(card.state);
}

/**
 * Builds a lightweight summary of an action card used for UI prioritisation.
 * @param {{ type: string; state: string; createdAt?: string; updatedAt?: string }} card
 * @param {{ definitions?: Record<string, any> }} [options]
 */
export function describeActionCard(card, options = {}) {
  const definition = getActionCardDefinition(card?.type, options);
  const pending = card ? !isTerminalState(card, options) : false;
  return {
    type: card?.type ?? 'UNKNOWN',
    state: card?.state ?? 'UNKNOWN',
    pending,
    category: definition?.category ?? null,
    lastUpdatedAt: card?.updatedAt ?? card?.createdAt ?? null
  };
}

export { DEFAULT_ACTION_CARD_DEFINITIONS };
