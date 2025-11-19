import crypto from 'node:crypto';

import { zonedDateTimeToUtc } from './timezone.js';

const DEFAULT_EVENT_DURATION_MINUTES = 60;

function unfoldLines(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .reduce((acc, line) => {
      if (!line) {
        return acc;
      }
      if (line.startsWith(' ') || line.startsWith('\t')) {
        const last = acc.pop() ?? '';
        acc.push(last + line.slice(1));
      } else {
        acc.push(line);
      }
      return acc;
    }, []);
}

function parseProperty(line) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return { name: line.trim(), params: {}, value: '' };
  }
  const nameAndParams = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1).trim();
  const segments = nameAndParams.split(';');
  const name = segments[0].toUpperCase();
  const params = {};
  for (let i = 1; i < segments.length; i += 1) {
    const [rawKey, rawValue] = segments[i].split('=');
    if (!rawKey || !rawValue) {
      continue;
    }
    params[rawKey.toUpperCase()] = rawValue;
  }
  return { name, params, value };
}

function formatDateString(compactDate) {
  if (compactDate.length !== 8) {
    throw new TypeError(`Unexpected ICS date format: ${compactDate}`);
  }
  return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
}

function formatTimeString(compactTime) {
  const normalized = compactTime.padEnd(6, '0').slice(0, 6);
  return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
}

function addDaysToDateString(dateIso, days) {
  const base = new Date(`${dateIso}T00:00:00Z`);
  const updated = new Date(base.getTime() + days * 86_400_000);
  return updated.toISOString().slice(0, 10);
}

function convertToUtc(value, params, options) {
  if (!value) {
    return null;
  }

  const upperValue = value.toUpperCase();
  if (upperValue.endsWith('Z')) {
    const trimmed = upperValue.slice(0, -1);
    let isoCandidate = value;
    if (/^\d{8}T\d{6}$/.test(trimmed)) {
      isoCandidate = `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T${trimmed.slice(9, 11)}:${trimmed.slice(11, 13)}:${trimmed.slice(13, 15)}Z`;
    } else if (/^\d{8}T\d{4}$/.test(trimmed)) {
      isoCandidate = `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T${trimmed.slice(9, 11)}:${trimmed.slice(11, 13)}:00Z`;
    }
    return new Date(isoCandidate).toISOString();
  }

  const tzid = params?.TZID ?? options.defaultTimezone ?? 'UTC';

  if (params?.VALUE === 'DATE') {
    const dateLocal = formatDateString(value);
    return zonedDateTimeToUtc(dateLocal, '00:00', tzid).toISOString();
  }

  if (value.length === 8) {
    const dateLocal = formatDateString(value);
    return zonedDateTimeToUtc(dateLocal, '00:00', tzid).toISOString();
  }

  const [rawDate, rawTime] = value.split('T');
  const dateLocal = formatDateString(rawDate);
  const timeLocal = formatTimeString(rawTime);
  return zonedDateTimeToUtc(dateLocal, timeLocal, tzid).toISOString();
}

function computeEventEnd(dtStart, dtEnd, options) {
  const defaultTimezone = options.defaultTimezone ?? 'UTC';
  if (dtEnd) {
    return convertToUtc(dtEnd.value, dtEnd.params, options);
  }
  const startIso = convertToUtc(dtStart.value, dtStart.params, options);
  if (!startIso) {
    return null;
  }
  if (dtStart.params?.VALUE === 'DATE') {
    const startDateIso = formatDateString(dtStart.value);
    const nextDateIso = addDaysToDateString(startDateIso, 1);
    return zonedDateTimeToUtc(nextDateIso, '00:00', dtStart.params?.TZID ?? defaultTimezone).toISOString();
  }
  const startDate = new Date(startIso);
  const endDate = new Date(startDate.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60_000);
  return endDate.toISOString();
}

export function parseIcsEvents(body, options = {}) {
  if (!body) {
    return [];
  }
  const defaultTimezone = options.defaultTimezone ?? 'UTC';
  const lines = unfoldLines(body);
  const events = [];
  let cursor = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === 'BEGIN:VEVENT') {
      cursor = {
        properties: {}
      };
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (cursor?.properties?.DTSTART) {
        const dtStart = cursor.properties.DTSTART;
        const dtEnd = cursor.properties.DTEND;
        const startUtc = convertToUtc(dtStart.value, dtStart.params, { defaultTimezone });
        const endUtc = computeEventEnd(dtStart, dtEnd, { defaultTimezone }) ?? startUtc;
        if (startUtc && endUtc) {
          events.push({
            uid: cursor.properties.UID?.value ?? crypto.randomUUID(),
            startUtc,
            endUtc,
            summary: cursor.properties.SUMMARY?.value,
            recurrenceId: cursor.properties['RECURRENCE-ID']?.value,
            busyType: cursor.properties.TRANSP?.value === 'TRANSPARENT' ? 'FREE' : 'BUSY'
          });
        }
      }
      cursor = null;
      continue;
    }
    if (!cursor) {
      continue;
    }
    const prop = parseProperty(trimmed);
    cursor.properties[prop.name] = { value: prop.value, params: prop.params };
  }

  return events;
}

export async function pollIcsSource(context) {
  const {
    sourceId,
    url,
    etag,
    lastModified,
    now = new Date().toISOString(),
    fetchImpl = globalThis.fetch,
    abortSignal,
    maxContentLengthBytes = 5_000_000
  } = context;

  if (!fetchImpl) {
    throw new Error('fetch implementation not available');
  }

  const headers = {
    'User-Agent': 'RastUp Calendar Poller/1.0'
  };
  if (etag) {
    headers['If-None-Match'] = etag;
  }
  if (lastModified) {
    headers['If-Modified-Since'] = lastModified;
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    signal: abortSignal
  });

  if (response.status === 304) {
    return {
      status: 'unchanged',
      etag: response.headers.get('ETag') ?? etag ?? null,
      lastModified: response.headers.get('Last-Modified') ?? lastModified ?? null,
      events: [],
      fetchedAt: now
    };
  }

  if (!response.ok) {
    const retriable = response.status >= 500 || response.status === 429;
    return {
      status: 'unchanged',
      events: [],
      fetchedAt: now,
      error: {
        message: `ICS fetch failed with status ${response.status}`,
        retriable
      }
    };
  }

  const contentLengthHeader = response.headers.get('Content-Length');
  if (contentLengthHeader && Number(contentLengthHeader) > maxContentLengthBytes) {
    return {
      status: 'unchanged',
      events: [],
      fetchedAt: now,
      error: {
        message: 'ICS payload exceeds configured maximum size',
        retriable: false
      }
    };
  }

  const bodyText = await response.text();
  const hash = crypto.createHash('sha256').update(bodyText).digest('hex');
  const events = parseIcsEvents(bodyText, { defaultTimezone: context.timezone });

  return {
    status: 'updated',
    etag: response.headers.get('ETag') ?? null,
    lastModified: response.headers.get('Last-Modified') ?? null,
    events,
    rawBodyHash: hash,
    fetchedAt: now
  };
}
