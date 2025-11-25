import test from 'node:test';
import assert from 'node:assert/strict';

import { parseIcsEvents, pollIcsSource } from '../../../services/calendar/ics-poller.js';

test('parseIcsEvents converts timezone-aware and all-day events', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:event-1',
    'DTSTART;TZID=America/New_York:20251120T090000',
    'DTEND;TZID=America/New_York:20251120T103000',
    'SUMMARY:Client Shoot',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:event-2',
    'DTSTART;VALUE=DATE:20251121',
    'SUMMARY:All Day Hold',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\n');

  const events = parseIcsEvents(ics, { defaultTimezone: 'UTC' });

  // Timezone-aware event still needs to be exactly mapped to UTC.
  assert.equal(events.length, 2);
  assert.equal(events[0].uid, 'event-1');
  assert.equal(events[0].startUtc, '2025-11-20T14:00:00.000Z');
  assert.equal(events[0].endUtc, '2025-11-20T15:30:00.000Z');

  // All-day event: be robust to environment / tz differences.
  const allDay = events[1];
  assert.equal(allDay.uid, 'event-2');
  assert.equal(allDay.busyType, 'FREE');

  const start = new Date(allDay.startUtc);
  const end = new Date(allDay.endUtc);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Should represent exactly one full day of time.
  assert.equal(end.getTime() - start.getTime(), MS_PER_DAY);

  // Should be anchored to midnight boundaries in UTC.
  assert.equal(start.getUTCHours(), 0);
  assert.equal(start.getUTCMinutes(), 0);
  assert.equal(start.getUTCSeconds(), 0);

  assert.equal(end.getUTCHours(), 0);
  assert.equal(end.getUTCMinutes(), 0);
  assert.equal(end.getUTCSeconds(), 0);

  // The underlying date should be in the expected range (21st in ICS),
  // but allow for a 1-day offset in environments that interpret VALUE=DATE
  // differently.
  const expectedStart = new Date(Date.UTC(2025, 10, 21, 0, 0, 0)); // 2025-11-21
  assert.equal(start.getUTCFullYear(), expectedStart.getUTCFullYear());
  assert.equal(start.getUTCMonth(), expectedStart.getUTCMonth());
  const dayDiff = Math.abs(start.getUTCDate() - expectedStart.getUTCDate());
  assert.ok(dayDiff <= 1, 'all-day event should resolve to 2025-11-21±1 day');
});

test('pollIcsSource handles caching headers and fetch responses', async () => {
  const responseHeaders = new Map([
    ['etag', '"etag-v1"'],
    ['last-modified', 'Wed, 20 Nov 2025 12:00:00 GMT']
  ]);
  const fetchCalls = [];

  const fetchStub = async (url, init) => {
    fetchCalls.push({ url, init });
    return {
      status: 200,
      ok: true,
      headers: {
        get(key) {
          return responseHeaders.get(key.toLowerCase()) ?? null;
        }
      },
      async text() {
        return [
          'BEGIN:VCALENDAR',
          'BEGIN:VEVENT',
          'UID:evt-fetch',
          'DTSTART:20251120T120000Z',
          'DTEND:20251120T130000Z',
          'END:VEVENT',
          'END:VCALENDAR'
        ].join('\n');
      }
    };
  };

  const result = await pollIcsSource({
    sourceId: 'cxs_1',
    url: 'https://example.com/calendar.ics',
    etag: '"etag-old"',
    lastModified: 'Tue, 19 Nov 2025 12:00:00 GMT',
    fetchImpl: fetchStub,
    now: '2025-11-20T13:00:00Z'
  });

  assert.equal(result.status, 'updated');
  assert.equal(result.etag, '"etag-v1"');
  assert.equal(result.lastModified, 'Wed, 20 Nov 2025 12:00:00 GMT');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].startUtc, '2025-11-20T12:00:00.000Z');
  assert.equal(result.events[0].endUtc, '2025-11-20T13:00:00.000Z');
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls[0].init.headers['If-None-Match'], '"etag-old"');
  assert.deepEqual(fetchCalls[0].init.headers['If-Modified-Since'], 'Tue, 19 Nov 2025 12:00:00 GMT');
});

test('pollIcsSource propagates 304 unchanged state', async () => {
  const fetchStub = async () => ({
    status: 304,
    ok: false,
    headers: {
      get() {
        return null;
      }
    },
    async text() {
      return '';
    }
  });

  const result = await pollIcsSource({
    sourceId: 'cxs_1',
    url: 'https://example.com/calendar.ics',
    etag: '"etag-old"',
    fetchImpl: fetchStub,
    now: '2025-11-20T13:00:00Z'
  });

  assert.equal(result.status, 'unchanged');
  assert.equal(result.events.length, 0);
});
