import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLbgSagaDefinition, buildSagaContext, createSagaExecutionPlan, runSaga, SagaInvariantError } from '../../services/booking/saga.js';
import { createIdempotencyStore } from '../../services/booking/idempotency.js';

test('buildLbgSagaDefinition produces expected states', () => {
  const definition = buildLbgSagaDefinition({ acceptanceWaitHours: 12, enableDisputePause: false });
  assert.equal(definition.States.ValidateDraft.Type, 'Task');
  assert.equal(definition.acceptanceWaitSeconds, 43200);
  assert.ok(!definition.States.DisputeGate);
});

test('createSagaExecutionPlan enforces docs signed flag', () => {
  const context = buildSagaContext({
    lbgId: 'lbg_1',
    legs: [{ legId: 'leg_1' }],
    docsSigned: true,
    chargeStatus: 'authorized'
  });
  const plan = createSagaExecutionPlan(context);
  assert.equal(plan.steps.length, 6);
});

test('runSaga executes handlers with idempotency', async () => {
  const context = buildSagaContext({
    lbgId: 'lbg_2',
    legs: [{ legId: 'leg_1' }],
    docsSigned: true,
    chargeStatus: 'authorized'
  });
  const plan = createSagaExecutionPlan(context);
  const idempotency = createIdempotencyStore();
  let counter = 0;
  const handlers = {
    validateDraft: async () => ({ ok: true }),
    ensureDocs: async () => ({ docs: true }),
    confirmPayment: async () => ({ payment: 'confirmed' }),
    waitForAcceptance: async ({ payload }) => payload.waitSeconds,
    queuePayouts: async () => ({ payouts: 2 }),
    completeBooking: async () => ({ done: true })
  };
  const firstRun = await runSaga(plan, { handlers, idempotency });
  counter += firstRun.length;
  const secondRun = await runSaga(plan, { handlers, idempotency });
  const skipped = secondRun.filter((step) => step.skipped);
  assert.equal(counter, 6);
  assert.equal(skipped.length, 6);
});

test('runSaga throws when handler missing', async () => {
  const context = buildSagaContext({
    lbgId: 'lbg_3',
    legs: [{ legId: 'leg_3' }],
    docsSigned: true,
    chargeStatus: 'authorized'
  });
  const plan = createSagaExecutionPlan(context);
  await assert.rejects(
    () => runSaga(plan, { handlers: {}, idempotency: createIdempotencyStore() }),
    (error) => error instanceof SagaInvariantError && error.code === 'HANDLER_MISSING'
  );
});

test('createSagaExecutionPlan rejects unsigned docs', () => {
  assert.throws(
    () =>
      createSagaExecutionPlan(
        buildSagaContext({
          lbgId: 'lbg_4',
          legs: [{ legId: 'leg_4' }],
          docsSigned: false,
          chargeStatus: 'authorized'
        })
      ),
    (error) => error instanceof SagaInvariantError && error.code === 'DOCS_REQUIRED'
  );
});
