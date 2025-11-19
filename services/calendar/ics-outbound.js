const DEFAULT_PRODUCT_ID = '-//RastUp//Calendar//EN';
const DEFAULT_CALENDAR_NAME = 'RastUp Availability';
const DEFAULT_METHOD = 'PUBLISH';
const MAX_LINE_LENGTH = 75;

function assertIso(value, label) {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be a valid ISO-8601 timestamp: ${value}`);
  }
  return timestamp;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function escapeText(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatUtc(iso) {
  const timestamp = assertIso(iso, 'datetime');
  const date = new Date(timestamp);
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

function formatDate(iso) {
  const timestamp = assertIso(iso, 'date');
  const date = new Date(timestamp);
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate())
  );
}

function formatInTimeZone(iso, timeZone) {
  const timestamp = assertIso(iso, 'datetime');
  const date = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((entry) => entry.type === type)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`;
}

function foldLine(line) {
  if (line.length <= MAX_LINE_LENGTH) {
    return [line];
  }
  const segments = [];
  let cursor = 0;
  while (cursor < line.length) {
    const slice = line.slice(cursor, cursor + MAX_LINE_LENGTH);
    segments.push(cursor === 0 ? slice : ` ${slice}`);
    cursor += MAX_LINE_LENGTH;
  }
  return segments;
}

function foldLines(lines) {
  return lines.flatMap((line) => foldLine(line));
}

function formatDateProperty(name, iso, options = {}) {
  if (!iso) {
    return null;
  }
  if (options.value === 'DATE' || options.allDay) {
    return `${name};VALUE=DATE:${formatDate(iso)}`;
  }
  if (options.timeZone) {
    return `${name};TZID=${options.timeZone}:${formatInTimeZone(iso, options.timeZone)}`;
  }
  return `${name}:${formatUtc(iso)}`;
}

function serializeOrganizer(organizer) {
  if (!organizer?.email) {
    return null;
  }
  const params = [];
  if (organizer.name) {
    params.push(`CN=${escapeText(organizer.name)}`);
  }
  const prefix = params.length > 0 ? `ORGANIZER;${params.join(';')}` : 'ORGANIZER';
  return `${prefix}:mailto:${organizer.email}`;
}

function serializeAttendee(attendee) {
  if (!attendee?.email) {
    return null;
  }
  const params = [];
  if (attendee.name) {
    params.push(`CN=${escapeText(attendee.name)}`);
  }
  if (attendee.role) {
    params.push(`ROLE=${attendee.role}`);
  }
  if (attendee.status) {
    params.push(`PARTSTAT=${attendee.status}`);
  }
  if (typeof attendee.rsvp === 'boolean') {
    params.push(`RSVP=${attendee.rsvp ? 'TRUE' : 'FALSE'}`);
  }
  const prefix = params.length > 0 ? `ATTENDEE;${params.join(';')}` : 'ATTENDEE';
  return `${prefix}:mailto:${attendee.email}`;
}

function serializeAlarms(alarms, fallbackSummary) {
  if (!Array.isArray(alarms) || alarms.length === 0) {
    return [];
  }
  const entries = [];
  for (const alarm of alarms) {
    const minutes = Math.max(1, Math.trunc(alarm?.triggerMinutesBefore ?? 15));
    const action = alarm?.action?.toUpperCase() ?? 'DISPLAY';
    const description = alarm?.description ?? fallbackSummary ?? 'Reminder';
    entries.push('BEGIN:VALARM');
    entries.push(`TRIGGER:-PT${minutes}M`);
    entries.push(`ACTION:${action}`);
    entries.push(`DESCRIPTION:${escapeText(description)}`);
    entries.push('END:VALARM');
  }
  return entries;
}

function serializeEvent(event, options = {}) {
  if (!event?.uid) {
    throw new Error('calendar event requires uid');
  }
  if (!event.startUtc) {
    throw new Error('calendar event requires startUtc');
  }
  const nowUtc = options.generatedAtUtc ?? new Date().toISOString();
  const timezone = event.timezone ?? options.defaultTimezone;
  const lines = ['BEGIN:VEVENT'];
  lines.push(`UID:${escapeText(event.uid)}`);
  const dtStamp = formatDateProperty('DTSTAMP', event.updatedAt ?? nowUtc);
  if (dtStamp) {
    lines.push(dtStamp);
  }
  const dtStart = formatDateProperty('DTSTART', event.startUtc, {
    timeZone: timezone,
    allDay: event.allDay
  });
  if (!dtStart) {
    throw new Error('failed to format DTSTART');
  }
  lines.push(dtStart);
  const dtEnd = formatDateProperty('DTEND', event.endUtc ?? event.startUtc, {
    timeZone: timezone,
    allDay: event.allDay
  });
  if (dtEnd) {
    lines.push(dtEnd);
  }
  if (event.recurrenceId) {
    const recurrenceLine = formatDateProperty('RECURRENCE-ID', event.recurrenceId, {
      timeZone: timezone,
      allDay: event.allDay
    });
    if (recurrenceLine) {
      lines.push(recurrenceLine);
    }
  }
  if (event.sequence != null) {
    lines.push(`SEQUENCE:${Math.max(0, Math.trunc(event.sequence))}`);
  }
  if (event.summary) {
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
  }
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeText(event.location)}`);
  }
  if (event.url) {
    lines.push(`URL:${escapeText(event.url)}`);
  }
  if (event.status) {
    lines.push(`STATUS:${event.status.toUpperCase()}`);
  }
  if (event.transparency) {
    lines.push(`TRANSP:${event.transparency.toUpperCase()}`);
  }
  if (event.createdAt) {
    lines.push(formatDateProperty('CREATED', event.createdAt));
  }
  if (event.updatedAt) {
    lines.push(formatDateProperty('LAST-MODIFIED', event.updatedAt));
  }
  const organizerLine = serializeOrganizer(event.organizer);
  if (organizerLine) {
    lines.push(organizerLine);
  }
  if (Array.isArray(event.attendees)) {
    for (const attendee of event.attendees) {
      const attendeeLine = serializeAttendee(attendee);
      if (attendeeLine) {
        lines.push(attendeeLine);
      }
    }
  }
  if (Array.isArray(event.categories) && event.categories.length > 0) {
    lines.push(`CATEGORIES:${event.categories.map((category) => escapeText(category)).join(',')}`);
  }
  const extras = event.extraProperties ?? event.extra ?? {};
  for (const [key, value] of Object.entries(extras)) {
    if (value == null) {
      continue;
    }
    const normalizedKey = String(key)
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '_');
    lines.push(`X-RASTUP-${normalizedKey}:${escapeText(value)}`);
  }
  lines.push(...serializeAlarms(event.alarms, event.summary));
  lines.push('END:VEVENT');
  return lines;
}

export function createIcsCalendar(options = {}) {
  const {
    productId = DEFAULT_PRODUCT_ID,
    calendarName = DEFAULT_CALENDAR_NAME,
    method = DEFAULT_METHOD,
    events = [],
    defaultTimezone,
    refreshIntervalMinutes,
    ttlSeconds,
    url,
    generatedAtUtc
  } = options;

  const lines = ['BEGIN:VCALENDAR'];
  lines.push(`PRODID:${escapeText(productId)}`);
  lines.push('VERSION:2.0');
  lines.push('CALSCALE:GREGORIAN');
  if (calendarName) {
    lines.push(`X-WR-CALNAME:${escapeText(calendarName)}`);
  }
  if (defaultTimezone) {
    lines.push(`X-WR-TIMEZONE:${escapeText(defaultTimezone)}`);
  }
  if (method) {
    lines.push(`METHOD:${method}`);
  }
  if (refreshIntervalMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${Math.max(1, Math.trunc(refreshIntervalMinutes))}M`);
  }
  if (ttlSeconds) {
    lines.push(`X-PUBLISHED-TTL:PT${Math.max(1, Math.trunc(ttlSeconds))}S`);
  }
  if (url) {
    lines.push(`URL:${escapeText(url)}`);
  }

  for (const event of events) {
    lines.push(
      ...serializeEvent(event, {
        defaultTimezone,
        generatedAtUtc
      })
    );
  }

  lines.push('END:VCALENDAR');
  return `${foldLines(lines).join('\r\n')}\r\n`;
}

export function createCalendarInvite(event, options = {}) {
  return createIcsCalendar({
    ...options,
    method: options.method ?? 'REQUEST',
    events: [event]
  });
}

export function buildIcsFeedUrl(config) {
  const baseUrl = config?.baseUrl;
  const token = config?.token;
  const pathTemplate = config?.pathTemplate ?? '/feeds/{token}.ics';
  if (!baseUrl) {
    throw new Error('baseUrl is required');
  }
  if (!token) {
    throw new Error('token is required');
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const replacedPath = pathTemplate.replace(
    '{token}',
    encodeURIComponent(String(token))
  );
  const normalizedPath = replacedPath.startsWith('/') ? replacedPath : `/${replacedPath}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function serializeCalendarEvent(event, options = {}) {
  return foldLines(
    serializeEvent(event, {
      defaultTimezone: options.defaultTimezone,
      generatedAtUtc: options.generatedAtUtc
    })
  ).join('\r\n');
}
