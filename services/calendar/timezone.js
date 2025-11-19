const FORMATTER_CACHE = new Map();

function getFormatter(timeZone) {
  if (!FORMATTER_CACHE.has(timeZone)) {
    FORMATTER_CACHE.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    );
  }
  return FORMATTER_CACHE.get(timeZone);
}

function parseDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map((part) => Number.parseInt(part, 10));
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    throw new TypeError(`Invalid date string: ${dateStr}`);
  }
  return { year, month, day };
}

function normalizeTimeString(timeStr) {
  if (!timeStr) {
    return '00:00';
  }
  const [hh, mm = '00'] = timeStr.split(':');
  const hNum = Number.parseInt(hh, 10);
  const mNum = Number.parseInt(mm, 10);
  if (
    Number.isNaN(hNum) ||
    Number.isNaN(mNum) ||
    hNum < 0 ||
    hNum > 23 ||
    mNum < 0 ||
    mNum > 59
  ) {
    throw new TypeError(`Invalid time string: ${timeStr}`);
  }
  const paddedH = String(hNum).padStart(2, '0');
  const paddedM = String(mNum).padStart(2, '0');
  return `${paddedH}:${paddedM}`;
}

function parseTime(timeStr) {
  const normalized = normalizeTimeString(timeStr);
  const [hour, minute] = normalized.split(':').map((part) => Number.parseInt(part, 10));
  return { hour, minute };
}

function getOffsetMinutes(timeZone, date) {
  const formatter = getFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const values = Object.create(null);
  for (const part of parts) {
    values[part.type] = part.value;
  }
  const utcEquivalent = Date.UTC(
    Number.parseInt(values.year, 10),
    Number.parseInt(values.month, 10) - 1,
    Number.parseInt(values.day, 10),
    Number.parseInt(values.hour, 10),
    Number.parseInt(values.minute, 10),
    Number.parseInt(values.second, 10)
  );
  return (utcEquivalent - date.getTime()) / 60000;
}

export function zonedDateTimeToUtc(dateStr, timeStr, timeZone) {
  const { year, month, day } = parseDate(dateStr);
  const { hour, minute } = parseTime(timeStr);
  let utcMillis = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = new Date(utcMillis);
  let offset = getOffsetMinutes(timeZone, candidate);
  utcMillis -= offset * 60000;
  candidate = new Date(utcMillis);
  const offsetAfter = getOffsetMinutes(timeZone, candidate);
  if (offsetAfter !== offset) {
    utcMillis -= (offsetAfter - offset) * 60000;
    candidate = new Date(utcMillis);
  }
  return candidate;
}

export function utcToZonedDateTime(date, timeZone) {
  const formatter = getFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const values = Object.create(null);
  for (const part of parts) {
    values[part.type] = part.value;
  }

  const offsetMinutes = getOffsetMinutes(timeZone, date);

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    offsetMinutes
  };
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

export function clampIntervalToRange(start, end, rangeStart, rangeEnd) {
  const clampedStart = Math.max(start, rangeStart);
  const clampedEnd = Math.min(end, rangeEnd);
  if (clampedEnd <= clampedStart) {
    return null;
  }
  return [clampedStart, clampedEnd];
}

export function minutesBetween(start, end) {
  return (end - start) / 60000;
}

export function toIsoString(date) {
  return date.toISOString();
}

export function isWithinRange(timestamp, min, max) {
  return timestamp >= min && timestamp <= max;
}

export function getMondayBasedWeekdayIndex(date) {
  const jsDay = date.getUTCDay(); // 0 => Sunday
  return (jsDay + 6) % 7; // Monday => 0, Sunday => 6
}
