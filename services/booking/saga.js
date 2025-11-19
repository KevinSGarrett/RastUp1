import { createIdempotencyStore } from './idempotency.js';

export class SagaInvariantError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SagaInvariantError';
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_ACCEPTANCE_HOURS = 48;

export function buildLbgSagaDefinition({ acceptanceWaitHours = DEFAULT_ACCEPTANCE_HOURS, enableDisputePause = true } = {}) {
  const states = {
    Comment: 'Linked Booking Group checkout saga',
    StartAt: 'ValidateDraft',
    States: {
      ValidateDraft: {
        Type: 'Task',
        Resource: 'arn:aws:lambda:::function:booking-validate-draft',
        Next: 'EnsureDocs',
        Catch: [
          {
            ErrorEquals: ['States.ALL'],
            ResultPath: '$.error',
            Next: 'SagaFailed'
          }
        ]
      },
      EnsureDocs: {
        Type: 'Task',
        Resource: 'arn:aws:lambda:::function:booking-ensure-docs',
        Next: 'ConfirmPayment',
        Catch: [
          {
            ErrorEquals: ['States.ALL'],
            ResultPath: '$.error',
            Next: 'SagaFailed'
          }
        ]
      },
      ConfirmPayment: {
        Type: 'Task',
        Resource: 'arn:aws:lambda:::function:booking-confirm-payment',
        Next: 'PostConfirm',
        Catch: [
          {
            ErrorEquals: ['States.ALL'],
            ResultPath: '$.error',
            Next: 'SagaFailed'
          }
        ]
      },
      PostConfirm: {
        Type: 'Parallel',
        Branches: [
          {
            StartAt: 'EmitEvents',
            States: {
              EmitEvents: {
                Type: 'Task',
                Resource: 'arn:aws:lambda:::function:booking-emit-events',
                End: true
              }
            }
          },
          {
            StartAt: 'AwaitAcceptance',
            States: {
              AwaitAcceptance: {
                Type: 'Wait',
                SecondsPath: '$.acceptanceWaitSeconds',
                Next: 'CheckAcceptance'
              },
              CheckAcceptance: {
                Type: 'Task',
                Resource: 'arn:aws:lambda:::function:booking-check-acceptance',
                End: true
              }
            }
          }
        ],
        Next: 'QueuePayouts'
      },
      QueuePayouts: {
        Type: 'Task',
        Resource: 'arn:aws:lambda:::function:booking-queue-payouts',
        Next: 'CompleteBooking',
        Catch: [
          {
            ErrorEquals: ['States.ALL'],
            ResultPath: '$.error',
            Next: 'SagaFailed'
          }
        ]
      },
      CompleteBooking: {
        Type: 'Task',
        Resource: 'arn:aws:lambda:::function:booking-complete',
        End: true
      },
      SagaFailed: {
        Type: 'Fail',
        Cause: 'BookingSagaFailed',
        Error: 'BOOKING_SAGA_FAILED'
      }
    },
    acceptanceWaitSeconds: acceptanceWaitHours * 60 * 60
  };

  if (enableDisputePause) {
    states.States.QueuePayouts.Next = 'DisputeGate';
    states.States.DisputeGate = {
      Type: 'Choice',
      Choices: [
        {
          Variable: '$.hasActiveDispute',
          BooleanEquals: true,
          Next: 'PauseForDispute'
        }
      ],
      Default: 'CompleteBooking'
    };
    states.States.PauseForDispute = {
      Type: 'Wait',
      Seconds: 86400,
      Next: 'DisputeRecheck'
    };
    states.States.DisputeRecheck = {
      Type: 'Task',
      Resource: 'arn:aws:lambda:::function:booking-check-dispute',
      Next: 'DisputeGate'
    };
  }

  return states;
}

export function buildSagaContext({ lbgId, legs, docsSigned, chargeStatus, acceptanceWindowHours = DEFAULT_ACCEPTANCE_HOURS, nowIso = new Date().toISOString() }) {
  if (!lbgId) {
    throw new SagaInvariantError('LBG_ID_REQUIRED', 'lbgId is required.', { lbgId });
  }
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new SagaInvariantError('LEGS_REQUIRED', 'At least one leg is required for saga context.', { legs });
  }
  return {
    lbgId,
    legs,
    docsSigned: Boolean(docsSigned),
    chargeStatus,
    nowIso,
    acceptanceWaitSeconds: acceptanceWindowHours * 60 * 60
  };
}

export function createSagaExecutionPlan(context) {
  if (!context.docsSigned) {
    throw new SagaInvariantError('DOCS_REQUIRED', 'Documents must be signed before starting saga.', { context });
  }
  const steps = [
    {
      name: 'VALIDATE_DRAFT',
      handler: 'validateDraft',
      idempotencyKey: `validate:${context.lbgId}`
    },
    {
      name: 'ENSURE_DOCS',
      handler: 'ensureDocs',
      idempotencyKey: `docs:${context.lbgId}`
    },
    {
      name: 'CONFIRM_PAYMENT',
      handler: 'confirmPayment',
      idempotencyKey: `payment:${context.lbgId}:${context.chargeStatus ?? 'unknown'}`
    },
    {
      name: 'WAIT_FOR_ACCEPTANCE',
      handler: 'waitForAcceptance',
      idempotencyKey: `acceptance:${context.lbgId}`,
      payload: { waitSeconds: context.acceptanceWaitSeconds }
    },
    {
      name: 'QUEUE_PAYOUTS',
      handler: 'queuePayouts',
      idempotencyKey: `payout:${context.lbgId}`
    },
    {
      name: 'COMPLETE_BOOKING',
      handler: 'completeBooking',
      idempotencyKey: `complete:${context.lbgId}`
    }
  ];
  return { context, steps };
}

export async function runSaga(executionPlan, { handlers, idempotency = createIdempotencyStore() }) {
  if (!executionPlan || !Array.isArray(executionPlan.steps)) {
    throw new SagaInvariantError('PLAN_REQUIRED', 'Execution plan is required.', { executionPlan });
  }
  const results = [];
  for (const step of executionPlan.steps) {
    const handler = handlers?.[step.handler];
    if (typeof handler !== 'function') {
      throw new SagaInvariantError('HANDLER_MISSING', `Handler ${step.handler} is not defined.`, { step });
    }
    const scope = `saga:${executionPlan.context.lbgId}`;
    const existing = idempotency.get(scope, step.idempotencyKey);
    if (existing && existing.status === 'consumed') {
      results.push({ step: step.name, skipped: true, response: existing.response });
      continue;
    }
    idempotency.reserve(scope, step.idempotencyKey);
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await handler({ context: executionPlan.context, payload: step.payload ?? {} });
      idempotency.commit(scope, step.idempotencyKey, response);
      results.push({ step: step.name, skipped: false, response });
    } catch (error) {
      throw new SagaInvariantError('STEP_FAILED', `Saga step ${step.name} failed.`, { step, error });
    }
  }
  return results;
}
