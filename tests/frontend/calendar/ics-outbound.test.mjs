import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIcsFeedUrl,
  createCalendarInvite,
  createIcsCalendar,
  serializeCalendarEvent
} from '../../../services/calendar/ics-outbound.js';

test('createIcsCalendar renders VEVENT with timezone, attendees, alarms, and folded lines', () => {
  const ics = createIcsCalendar({
    calendarName: 'Provider Availability',
    defaultTimezone: 'America/New_York',
    events: [
      {
        uid: 'evt_1',
        startUtc: '2025-11-20T15:00:00Z',
        endUtc: '2025-11-20T16:30:00Z',
        summary: 'Portrait Session Hold',
        description: 'Hold: portrait session\nPlease arrive 15 minutes early.',
        location: 'Studio A, Brooklyn',
        status: 'CONFIRMED',
        transparency: 'OPAQUE',
        organizer: { name: 'RastUp Scheduling', email: 'calendar@rastup.example' },
        attendees: [
          { name: 'Provider', email: 'provider@example.com', role: 'REQ-PARTICIPANT', status: 'ACCEPTED' },
          { name: 'Buyer', email: 'buyer@example.com', role: 'REQ-PARTICIPANT', status: 'NEEDS-ACTION', rsvp: true }
        ],
        categories: ['BOOKING', 'HOLD'],
        alarms: [{ triggerMinutesBefore: 30, description: 'Upcoming booking – hold' }],
        extraProperties: { booking_id: 'ord_123', hold: true }
      }
    ]
  });

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /PRODID:-\/\/RastUp\/\/Calendar\/\/EN/);
  assert.match(ics, /CALSCALE:GREGORIAN/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /UID:evt_1/);
  assert.match(ics, /SUMMARY:Portrait Session Hold/);
  assert.match(ics, /DTSTART;TZID=America\/New_York:20251120T100000/);
  assert.match(ics, /DTEND;TZID=America\/New_York:20251120T113000/);
  assert.match(ics, /DESCRIPTION:Hold: portrait session\\nPlease arrive 15 minutes early\./);
  assert.match(ics, /TRIGGER:-PT30M/);
  assert.match(ics, /X-RASTUP-BOOKING_ID:ord_123/);
  assert.match(ics, /\r\n /, 'long lines should be folded according to RFC5545');
});

test('createCalendarInvite defaults to METHOD:REQUEST and supports all-day events', () => {
  const ics = createCalendarInvite(
    {
      uid: 'evt_all_day',
      startUtc: '2025-12-25T00:00:00Z',
      endUtc: '2025-12-26T00:00:00Z',
      allDay: true,
      summary: 'Studio Blackout',
      status: 'CANCELLED'
    },
    {
      productId: '-//Test//Schedule//EN',
      calendarName: 'Studio Calendar'
    }
  );

  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, /DTSTART;VALUE=DATE:20251225/);
  assert.match(ics, /DTEND;VALUE=DATE:20251226/);
  assert.match(ics, /STATUS:CANCELLED/);
});

test('serializeCalendarEvent returns single VEVENT', () => {
  const vevent = serializeCalendarEvent(
    {
      uid: 'evt_single',
      startUtc: '2025-11-21T18:00:00Z',
      endUtc: '2025-11-21T19:00:00Z',
      summary: 'Preview Slot',
      timezone: 'UTC'
    },
    { generatedAtUtc: '2025-11-19T12:00:00Z' }
  );

  assert.match(vevent, /^BEGIN:VEVENT/);
  assert.match(vevent, /DTSTAMP:20251119T120000Z/);
  assert.match(vevent, /DTSTART;TZID=UTC:20251121T180000/);
  assert.match(vevent, /END:VEVENT$/);
});

test('buildIcsFeedUrl composes deterministic feed URLs', () => {
  assert.equal(
    buildIcsFeedUrl({ baseUrl: 'https://calendar.rastup.example', token: 'abc123' }),
    'https://calendar.rastup.example/feeds/abc123.ics'
  );
  assert.equal(
    buildIcsFeedUrl({
      baseUrl: 'https://calendar.rastup.example/',
      token: 'tok-789',
      pathTemplate: '/ics/{token}/calendar.ics'
    }),
    'https://calendar.rastup.example/ics/tok-789/calendar.ics'
  );
});
