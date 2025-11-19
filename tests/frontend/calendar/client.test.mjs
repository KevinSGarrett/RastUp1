import test from 'node:test';
import assert from 'node:assert/strict';

import { createCalendarClient } from '../../../tools/frontend/calendar/client.mjs';

function createStubExecutor(responders) {
  const calls = [];
  const executor = async ({ query, variables, operationName }) => {
    calls.push({ query, variables, operationName });
    for (const responder of responders) {
      const result = await responder({ query, variables, operationName });
      if (result !== undefined) {
        return result;
      }
    }
    throw new Error(`Unexpected GraphQL operation: ${operationName ?? query.slice(0, 40)}`);
  };
  executor.getCalls = () => calls;
  return executor;
}

test('calendar client fetchDashboard maps GraphQL data to DX format', async () => {
  const executor = createStubExecutor([
    async ({ operationName }) => {
      if (operationName === 'CalendarDashboard') {
        return {
          data: {
            weekly: [
              {
                id: 'wr_1',
                role: 'MODEL',
                weekdayMask: 62,
                startLocal: '09:00',
                endLocal: '17:00',
                timezone: 'America/Los_Angeles',
                minDurationMin: 60,
                leadTimeHours: 24,
                bookingWindowDays: 45,
                bufferBeforeMin: 15,
                bufferAfterMin: 15,
                active: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-05T00:00:00Z'
              }
            ],
            exceptions: [
              {
                id: 'ex_1',
                dateLocal: '2025-01-08',
                timezone: 'America/Los_Angeles',
                kind: 'unavailable',
                startLocal: null,
                endLocal: null,
                note: null,
                createdAt: '2025-01-02T00:00:00Z'
              }
            ],
            holds: [
              {
                id: 'hld_1',
                startUtc: '2025-01-10T17:00:00Z',
                endUtc: '2025-01-10T18:00:00Z',
                source: 'checkout',
                orderId: null,
                ttlExpiresAt: '2025-01-10T17:30:00Z',
                createdAt: '2025-01-10T16:59:00Z'
              }
            ],
            events: [
              {
                id: 'evt_1',
                orderId: 'ord_1',
                startUtc: '2025-01-11T17:00:00Z',
                endUtc: '2025-01-11T18:00:00Z',
                status: 'confirmed',
                createdAt: '2025-01-11T16:50:00Z',
                updatedAt: '2025-01-11T16:55:00Z'
              }
            ],
            sources: [
              {
                id: 'cxs_1',
                kind: 'ics',
                urlOrRemoteId: 'https://calendar.google.com/private.ics',
                status: 'active',
                lastPollAt: '2025-01-09T12:00:00Z',
                lastEtag: '"etag"',
                lastModified: '2025-01-09T12:00:00Z',
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-09T12:00:00Z'
              }
            ],
            externalBusy: [
              {
                id: 'xev_1',
                sourceId: 'cxs_1',
                startUtc: '2025-01-09T15:00:00Z',
                endUtc: '2025-01-09T16:00:00Z',
                busy: true,
                summary: 'External busy',
                recurrenceId: null,
                updatedAt: '2025-01-09T12:00:00Z'
              }
            ],
            slots: [
              {
                startUtc: '2025-01-12T17:00:00Z',
                endUtc: '2025-01-12T18:00:00Z',
                sourceRuleId: 'wr_1',
                confidence: 0.9
              }
            ],
            feed: {
              id: 'feed_1',
              token: 'ics-token',
              includeHolds: true,
              createdAt: '2025-01-05T00:00:00Z'
            }
          }
        };
      }
      return undefined;
    }
  ]);

  const client = createCalendarClient({ execute: executor });
  const result = await client.fetchDashboard({
    role: 'MODEL',
    exceptionRange: { dateFrom: '2025-01-01', dateTo: '2025-01-15' },
    calendarRange: { start: '2025-01-01T00:00:00Z', end: '2025-01-31T23:59:59Z' },
    durationMin: 90
  });

  assert.equal(result.weeklyRules.length, 1);
  assert.equal(result.weeklyRules[0].ruleId, 'wr_1');
  assert.equal(result.holds[0].holdId, 'hld_1');
  assert.equal(result.events[0].eventId, 'evt_1');
  assert.equal(result.externalSources[0].srcId, 'cxs_1');
  assert.equal(result.externalBusy[0].extEventId, 'xev_1');
  assert.equal(result.feasibleSlots[0].slotId.includes('wr_1'), true);
  assert.equal(result.icsFeed.token, 'ics-token');

  const dashboardCall = executor.getCalls()[0];
  assert.equal(dashboardCall.operationName, 'CalendarDashboard');
  assert.equal(dashboardCall.variables.role, 'MODEL');
  assert.equal(dashboardCall.variables.feasibleInput.durationMin, 90);
});

test('calendar client createHoldAndConfirm releases hold on booking failure', async () => {
  let releaseCount = 0;
  const executor = createStubExecutor([
    async ({ operationName }) => {
      switch (operationName) {
        case 'CreateHold':
          return { data: { createHold: 'hld_123' } };
        case 'CalendarHolds':
          return {
            data: {
              holds: [
                {
                  id: 'hld_123',
                  startUtc: '2025-01-15T18:00:00Z',
                  endUtc: '2025-01-15T19:00:00Z',
                  source: 'checkout',
                  orderId: null,
                  ttlExpiresAt: '2025-01-15T18:30:00Z',
                  createdAt: '2025-01-15T17:59:00Z'
                }
              ]
            }
          };
        case 'ReleaseHold':
          releaseCount += 1;
          return { data: { releaseHold: true } };
        default:
          return undefined;
      }
    }
  ]);

  const booking = {
    async confirmHold() {
      throw new Error('payment_failed');
    }
  };

  const client = createCalendarClient({
    execute: executor,
    booking,
    defaultHoldTtlMinutes: 20
  });

  await assert.rejects(
    async () =>
      client.createHoldAndConfirm({
        hold: {
          role: 'MODEL',
          startUtc: '2025-01-15T18:00:00Z',
          endUtc: '2025-01-15T19:00:00Z',
          source: 'checkout'
        },
        booking: {
          draftId: 'draft_123'
        }
      }),
    /payment_failed/
  );

  assert.equal(releaseCount, 1);
});

test('calendar client createHoldAndConfirm returns confirmation on success', async () => {
  const executor = createStubExecutor([
    async ({ operationName }) => {
      switch (operationName) {
        case 'CreateHold':
          return { data: { createHold: 'hld_success' } };
        case 'CalendarHolds':
          return {
            data: {
              holds: [
                {
                  id: 'hld_success',
                  startUtc: '2025-02-01T10:00:00Z',
                  endUtc: '2025-02-01T11:00:00Z',
                  source: 'checkout',
                  orderId: null,
                  ttlExpiresAt: '2025-02-01T10:30:00Z',
                  createdAt: '2025-02-01T09:59:00Z'
                }
              ]
            }
          };
        case 'ReleaseHold':
          return { data: { releaseHold: true } };
        default:
          return undefined;
      }
    }
  ]);

  const bookingCalls = [];
  const booking = {
    async confirmHold(payload) {
      bookingCalls.push(payload);
      return { eventId: 'evt_conf', orderId: 'ord_123' };
    }
  };

  const client = createCalendarClient({ execute: executor, booking });
  const result = await client.createHoldAndConfirm({
    hold: {
      role: 'MODEL',
      startUtc: '2025-02-01T10:00:00Z',
      endUtc: '2025-02-01T11:00:00Z',
      source: 'checkout'
    },
    booking: {
      draftId: 'draft_abc',
      paymentIntentId: 'pi_123'
    }
  });

  assert.equal(result.hold.holdId, 'hld_success');
  assert.equal(result.confirmation.eventId, 'evt_conf');
  assert.equal(bookingCalls.length, 1);
  assert.equal(bookingCalls[0].hold.holdId, 'hld_success');
});
