const WEEKDAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * Converts a weekday mask (Mon bit = 1 << 0) into a Set of weekday strings.
 * @param {number} mask
 * @returns {Set<string>}
 */
export function weekdayMaskToSet(mask = 0) {
  const set = new Set();
  for (let idx = 0; idx < WEEKDAY_ORDER.length; idx += 1) {
    if ((mask & (1 << idx)) !== 0) {
      set.add(WEEKDAY_ORDER[idx]);
    }
  }
  return set;
}

/**
 * Parses an ISO date string into year/month/day integers.
 * @param {string} dateLike YYYY-MM-DD
 * @returns {{ year: number, month: number, day: number }}
 */
export function parseDateParts(dateLike) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLike)) {
    throw new Error(`Invalid date format: ${dateLike}`);
  }
  const [year, month, day] = dateLike.split('-').map((value) => Number.parseInt(value, 10));
  return { year, month, day };
}

/**
 * Parses a HH:MM string into hour/minute integers.
 * @param {string} timeLike
 * @returns {{ hour: number, minute: number }}
 */
export function parseTimeParts(timeLike) {
  if (!/^\d{2}:\d{2}$/.test(timeLike)) {
    throw new Error(`Invalid time format: ${timeLike}`);
  }
  const [hour, minute] = timeLike.split(':').map((value) => Number.parseInt(value, 10));
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid time range: ${timeLike}`);
  }
  return { hour, minute };
}

/**
 * Returns the weekday string for a given ISO date in a time zone.
 * @param {string} dateLike YYYY-MM-DD
 * @param {string} timeZone IANA zone
 * @returns {'MON'|'TUE'|'WED'|'THU'|'FRI'|'SAT'|'SUN'}
 */
export function getWeekday(dateLike, timeZone) {
  const date = new Date(`${dateLike}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short'
  });
  const value = formatter.format(date).toUpperCase();
  switch (value) {
    case 'MON':
    case 'TUE':
    case 'WED':
    case 'THU':
    case 'FRI':
    case 'SAT':
    case 'SUN':
      return value;
    default:
      throw new Error(`Unsupported weekday: ${value}`);
  }
}

function getTemporal() {
  return globalThis?.Temporal;
}

function ensureTemporalPlainDate(dateLike) {
  const Temporal = getTemporal();
  if (Temporal?.PlainDate) {
    return Temporal.PlainDate.from(dateLike);
  }
  return null;
}

/**
 * Converts a local date/time in a target time zone to epoch milliseconds (UTC).
 * Prefers Temporal when available to get correct DST handling.
 * @param {string} dateLike YYYY-MM-DD
 * @param {string} timeLike HH:MM
 * @param {string} timeZone
 * @returns {number}
 */
export function zonedDateTimeToEpochMs(dateLike, timeLike, timeZone) {
  const { hour, minute } = parseTimeParts(timeLike);

  const plainDate = ensureTemporalPlainDate(dateLike);
  const Temporal = getTemporal();
  if (Temporal?.PlainDateTime && Temporal?.ZonedDateTime && plainDate) {
    const plainDateTime = Temporal.PlainDateTime.from({
      ...plainDate.getISOFields(),
      hour,
      minute,
      second: 0,
      millisecond: 0
    });
    const zoned = Temporal.ZonedDateTime.from({
      timeZone,
      plainDateTime
    });
    return zoned.toInstant().epochMilliseconds;
  }

  // Fallback using Intl.DateTimeFormat to compute offset
  const { year, month, day } = parseDateParts(dateLike);
  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = formatter.formatToParts(new Date(approxUtc));
  const get = (type) => Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const zonedUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'), 0);
  const offsetMs = zonedUtc - approxUtc;
  return approxUtc - offsetMs;
}

/**
 * Converts epoch milliseconds to ISO string without milliseconds.
 * @param {number} epochMs
 * @returns {string}
 */
export function toIsoString(epochMs) {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Adds minutes to an epoch timestamp.
 * @param {number} epochMs
 * @param {number} minutes
 * @returns {number}
 */
export function addMinutes(epochMs, minutes) {
  return epochMs + minutes * 60 * 1000;
}

/**
 * Generates ISO dates from dateFrom to dateTo inclusive.
 * @param {string} dateFrom
 * @param {string} dateTo
 */
export function* iterateDates(dateFrom, dateTo) {
  const start = parseDateParts(dateFrom);
  const end = parseDateParts(dateTo);
  let current = new Date(Date.UTC(start.year, start.month - 1, start.day, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day, 0, 0, 0, 0));
  while (current <= endDate) {
    const iso = current.toISOString().slice(0, 10);
    yield iso;
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }
}

/**
 * Returns true if weekday mask includes given weekday string.
 * @param {number} mask
 * @param {string} weekday
 * @returns {boolean}
 */
export function maskIncludesWeekday(mask, weekday) {
  const set = weekdayMaskToSet(mask);
  return set.has(weekday);
}

export function compareIntervals(a, b) {
  if (a.start === b.start) {
    return a.end - b.end;
  }
  return a.start - b.start;
}

/**
 * Merges overlapping or touching intervals in milliseconds.
 * @param {Array<{ start: number; end: number; meta?: any }>} intervals
 * @returns {Array<{ start: number; end: number; meta?: any }>}
 */
export function mergeIntervals(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return [];
  }
  const sorted = [...intervals].sort(compareIntervals);
  const merged = [];
  for (const interval of sorted) {
    if (merged.length === 0) {
      merged.push({ ...interval });
      continue;
    }
    const last = merged[merged.length - 1];
    if (interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
      if (interval.meta || last.meta) {
        last.meta = { ...last.meta, ...interval.meta };
      }
    } else if (interval.start === last.end) {
      last.end = interval.end;
      if (interval.meta || last.meta) {
        last.meta = { ...last.meta, ...interval.meta };
      }
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Subtracts subtractor intervals from source intervals.
 * @param {Array<{ start: number; end: number; meta?: any }>} source
 * @param {Array<{ start: number; end: number; meta?: any }>} subtractors
 * @returns {Array<{ start: number; end: number; meta?: any }>}
 */
export function subtractIntervals(source, subtractors) {
  if (!Array.isArray(source) || source.length === 0) {
    return [];
  }
  if (!Array.isArray(subtractors) || subtractors.length === 0) {
    return [...source];
  }
  const sortedSubtractors = [...subtractors].sort(compareIntervals);
  const result = [];
  for (const interval of source) {
    let segments = [{ start: interval.start, end: interval.end, meta: interval.meta }];
    for (const sub of sortedSubtractors) {
      const nextSegments = [];
      for (const seg of segments) {
        if (sub.end <= seg.start || sub.start >= seg.end) {
          nextSegments.push(seg);
          continue;
        }
        if (sub.start > seg.start) {
          nextSegments.push({ start: seg.start, end: sub.start, meta: seg.meta });
        }
        if (sub.end < seg.end) {
          nextSegments.push({ start: sub.end, end: seg.end, meta: seg.meta });
        }
      }
      segments = nextSegments;
      if (segments.length === 0) {
        break;
      }
    }
    result.push(...segments);
  }
  return mergeIntervals(result);
}
