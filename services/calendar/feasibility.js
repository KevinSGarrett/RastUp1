import {
  zonedDateTimeToUtc,
  utcToZonedDateTime,
  getMondayBasedWeekdayIndex,
  clampIntervalToRange,
  minutesBetween
} from './timezone.js';

const MILLIS_PER_MINUTE = 60_000;
const MILLIS_PER_DAY = 86_400_000;
const DEFAULT_MAX_SLOTS = 100;

function isoToMillis(iso) {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) {
    throw new TypeError(`Invalid ISO timestamp: ${iso}`);
  }
  return value;
}

function addDaysToDateString(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  const updated = new Date(base.getTime() + days * MILLIS_PER_DAY);
  return updated.toISOString().slice(0, 10);
}

function normalizeBufferValue(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function buildRuleDefaults(rules) {
  const defaults = new Map();
  for (const rule of rules) {
    const key = `${rule.userId}|${rule.roleCode}|${rule.timezone}`;
    if (!defaults.has(key)) {
      defaults.set(key, {
        timezone: rule.timezone,
        minDurationMin: rule.minDurationMin ?? 60,
        leadTimeMinutes: (rule.leadTimeHours ?? 24) * 60,
        bookingWindowMinutes: (rule.bookingWindowDays ?? 60) * 24 * 60,
        bufferBeforeMin: normalizeBufferValue(rule.bufferBeforeMin),
        bufferAfterMin: normalizeBufferValue(rule.bufferAfterMin)
      });
      continue;
    }
    const existing = defaults.get(key);
    existing.minDurationMin = Math.min(existing.minDurationMin, rule.minDurationMin ?? existing.minDurationMin);
    existing.leadTimeMinutes = Math.min(existing.leadTimeMinutes, (rule.leadTimeHours ?? 24) * 60);
    existing.bookingWindowMinutes = Math.max(existing.bookingWindowMinutes, (rule.bookingWindowDays ?? 60) * 24 * 60);
    existing.bufferBeforeMin = Math.max(existing.bufferBeforeMin, normalizeBufferValue(rule.bufferBeforeMin));
    existing.bufferAfterMin = Math.max(existing.bufferAfterMin, normalizeBufferValue(rule.bufferAfterMin));
  }
  return defaults;
}

function resolveLocalInterval(dateLocal, startLocal, endLocal, timezone) {
  const effectiveStartLocal = startLocal ?? '00:00';
  let effectiveEndLocal = endLocal;
  let endDateLocal = dateLocal;
  if (!effectiveEndLocal) {
    endDateLocal = addDaysToDateString(dateLocal, 1);
    effectiveEndLocal = '00:00';
  } else if (effectiveEndLocal === '24:00') {
    endDateLocal = addDaysToDateString(dateLocal, 1);
    effectiveEndLocal = '00:00';
  }

  const startUtc = zonedDateTimeToUtc(dateLocal, effectiveStartLocal, timezone);
  const endUtc = zonedDateTimeToUtc(endDateLocal, effectiveEndLocal, timezone);

  if (endUtc <= startUtc) {
    return null;
  }
  return [startUtc.getTime(), endUtc.getTime()];
}

function isRuleActiveOnDate(rule, dateStr) {
  const utcDate = new Date(`${dateStr}T00:00:00Z`);
  const weekdayIndex = getMondayBasedWeekdayIndex(utcDate);
  const mask = Number(rule.weekdayMask ?? 0);
  return (mask & (1 << weekdayIndex)) > 0;
}

function subtractInterval(baseInterval, removalInterval) {
  const { start, end } = baseInterval;
  const [blockingStart, blockingEnd] = removalInterval;
  if (blockingEnd <= start || blockingStart >= end) {
    return [baseInterval];
  }
  const segments = [];
  if (blockingStart > start) {
    segments.push({
      ...baseInterval,
      end: Math.max(start, Math.min(blockingStart, end))
    });
  }
  if (blockingEnd < end) {
    segments.push({
      ...baseInterval,
      start: Math.min(end, Math.max(blockingEnd, start))
    });
  }
  return segments.filter((segment) => segment.end > segment.start);
}

function subtractIntervals(intervals, blockingIntervals) {
  let current = intervals.slice();
  for (const blocking of blockingIntervals) {
    const next = [];
    for (const interval of current) {
      const residual = subtractInterval(interval, blocking);
      if (residual.length > 0) {
        next.push(...residual);
      }
    }
    current = next;
    if (current.length === 0) {
      break;
    }
  }
  return current;
}

function dedupeAndSortIntervals(intervals) {
  return intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function buildRemovalIntervalsFromExceptions(exceptions = [], timezoneLookup = new Map()) {
  const removals = [];
  for (const exception of exceptions) {
    if (exception.kind !== 'unavailable') {
      continue;
    }
    const tz = exception.timezone || timezoneLookup.get(exception.userId) || 'UTC';
    const interval = resolveLocalInterval(
      exception.dateLocal,
      exception.startLocal ?? undefined,
      exception.endLocal ?? undefined,
      tz
    );
    if (interval) {
      removals.push(interval);
    }
  }
  return removals;
}

function buildBusyIntervals({ holds = [], nowMillis, includeHolds = false, confirmedEvents = [], externalBusy = [] }) {
  const busy = [];
  const now = nowMillis ?? Date.now();

  for (const hold of holds) {
    const holdEnd = isoToMillis(hold.ttlExpiresAt ?? hold.endUtc);
    if (!includeHolds && holdEnd <= now) {
      continue;
    }
    const start = isoToMillis(hold.startUtc);
    const end = isoToMillis(hold.endUtc);
    if (end > start) {
      busy.push([start, end]);
    }
  }

  for (const event of confirmedEvents) {
    if (event.status && event.status !== 'confirmed') {
      continue;
    }
    const start = isoToMillis(event.startUtc);
    const end = isoToMillis(event.endUtc);
    if (end > start) {
      busy.push([start, end]);
    }
  }

  for (const ext of externalBusy) {
    if (ext.busy === false) {
      continue;
    }
    const start = isoToMillis(ext.startUtc);
    const end = isoToMillis(ext.endUtc);
    if (end > start) {
      busy.push([start, end]);
    }
  }

  return busy;
}

function createWeeklyRuleWindows(rule, windowStartMillis, windowEndMillis, exceptionMap) {
  const timezone = rule.timezone;
  const startZoned = utcToZonedDateTime(new Date(windowStartMillis), timezone);
  const endZoned = utcToZonedDateTime(new Date(windowEndMillis - 1), timezone);

  const windows = [];

  const defaults = {
    leadTimeMinutes: (rule.leadTimeHours ?? 24) * 60,
    bookingWindowMinutes: (rule.bookingWindowDays ?? 60) * 24 * 60,
    minDurationMin: rule.minDurationMin ?? 60,
    bufferBeforeMin: normalizeBufferValue(rule.bufferBeforeMin),
    bufferAfterMin: normalizeBufferValue(rule.bufferAfterMin)
  };

  let cursorDate = startZoned.date;
  while (cursorDate <= endZoned.date) {
    if (rule.active === false) {
      break;
    }
    const exceptionKey = `${timezone}|${cursorDate}`;
    const hasDayBlocked = (exceptionMap.get(exceptionKey) ?? []).some((ex) => {
      return ex.kind === 'unavailable' && !ex.startLocal && !ex.endLocal;
    });

    if (!hasDayBlocked && isRuleActiveOnDate(rule, cursorDate)) {
      const interval = resolveLocalInterval(cursorDate, rule.startLocal, rule.endLocal, timezone);
      if (interval) {
        const clamped = clampIntervalToRange(
          interval[0],
          interval[1],
          windowStartMillis,
          windowEndMillis
        );
        if (clamped) {
          windows.push({
            start: clamped[0],
            end: clamped[1],
            ruleId: rule.ruleId,
            timezone,
            leadTimeMinutes: defaults.leadTimeMinutes,
            bookingWindowMinutes: defaults.bookingWindowMinutes,
            minDurationMin: defaults.minDurationMin,
            bufferBeforeMin: defaults.bufferBeforeMin,
            bufferAfterMin: defaults.bufferAfterMin,
            source: 'weekly',
            dateLocal: cursorDate
          });
        }
      }
    }
    cursorDate = addDaysToDateString(cursorDate, 1);
  }

  return windows;
}

function indexExceptionsByTimezoneDate(exceptions = []) {
  const map = new Map();
  for (const exception of exceptions) {
    const key = `${exception.timezone}|${exception.dateLocal}`;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(exception);
  }
  return map;
}

function createAvailableExceptionWindows(exceptions = [], ruleDefaults, windowStartMillis, windowEndMillis) {
  const windows = [];
  for (const exception of exceptions) {
    if (exception.kind !== 'available') {
      continue;
    }
    const key = `${exception.userId}|${exception.roleCode ?? ''}|${exception.timezone}`;
    const defaults = ruleDefaults.get(key) ?? {
      timezone: exception.timezone,
      minDurationMin: 60,
      leadTimeMinutes: 24 * 60,
      bookingWindowMinutes: 60 * 24 * 60,
      bufferBeforeMin: 0,
      bufferAfterMin: 0
    };
    const interval = resolveLocalInterval(
      exception.dateLocal,
      exception.startLocal ?? undefined,
      exception.endLocal ?? undefined,
      exception.timezone
    );
    if (!interval) {
      continue;
    }
    const clamped = clampIntervalToRange(interval[0], interval[1], windowStartMillis, windowEndMillis);
    if (!clamped) {
      continue;
    }
    windows.push({
      start: clamped[0],
      end: clamped[1],
      ruleId: exception.excId,
      timezone: exception.timezone,
      leadTimeMinutes: defaults.leadTimeMinutes,
      bookingWindowMinutes: defaults.bookingWindowMinutes,
      minDurationMin: defaults.minDurationMin,
      bufferBeforeMin: defaults.bufferBeforeMin,
      bufferAfterMin: defaults.bufferAfterMin,
      source: 'exception',
      dateLocal: exception.dateLocal
    });
  }
  return windows;
}

export function computeFeasibleSlots(input) {
  const {
    weeklyRules = [],
    exceptions = [],
    holds = [],
    confirmedEvents = [],
    externalBusy = [],
    windowStartUtc,
    windowEndUtc,
    nowUtc,
    durationMin,
    includeHolds = false,
    maxSlots = DEFAULT_MAX_SLOTS
  } = input;

  if (!windowStartUtc || !windowEndUtc) {
    throw new TypeError('windowStartUtc and windowEndUtc are required');
  }
  const windowStartMillis = isoToMillis(windowStartUtc);
  const windowEndMillis = isoToMillis(windowEndUtc);
  if (windowEndMillis <= windowStartMillis) {
    throw new TypeError('windowEndUtc must be later than windowStartUtc');
  }
  const requiredDuration = Math.max(1, Math.trunc(durationMin));
  const nowMillis = nowUtc ? isoToMillis(nowUtc) : Date.now();

  const activeRules = weeklyRules.filter((rule) => rule.active !== false);
  const ruleDefaults = buildRuleDefaults(activeRules);
  const exceptionIndex = indexExceptionsByTimezoneDate(exceptions);

  const weeklyWindows = [];
  for (const rule of activeRules) {
    weeklyWindows.push(
      ...createWeeklyRuleWindows(rule, windowStartMillis, windowEndMillis, exceptionIndex)
    );
  }

  const availableExceptionWindows = createAvailableExceptionWindows(
    exceptions,
    ruleDefaults,
    windowStartMillis,
    windowEndMillis
  );

  const candidateWindows = dedupeAndSortIntervals([...weeklyWindows, ...availableExceptionWindows]);

  const removalIntervals = buildRemovalIntervalsFromExceptions(exceptions);
  const busyIntervals = buildBusyIntervals({
    holds,
    nowMillis,
    includeHolds,
    confirmedEvents,
    externalBusy
  });

  const slots = [];
  let removedByLeadTime = 0;
  let removedByBookingWindow = 0;
  let removedByConflicts = 0;
  let removedByDuration = 0;

  for (const candidate of candidateWindows) {
    let windowsAfterRemovals = subtractIntervals([candidate], removalIntervals);
    if (windowsAfterRemovals.length === 0) {
      removedByConflicts += 1;
      continue;
    }
    windowsAfterRemovals = subtractIntervals(windowsAfterRemovals, busyIntervals);
    if (windowsAfterRemovals.length === 0) {
      removedByConflicts += 1;
      continue;
    }

    for (const window of windowsAfterRemovals) {
      let workingStart = window.start + candidate.bufferBeforeMin * MILLIS_PER_MINUTE;
      let workingEnd = window.end - candidate.bufferAfterMin * MILLIS_PER_MINUTE;

      if (workingEnd <= workingStart) {
        removedByDuration += 1;
        continue;
      }

      const leadCutoff = nowMillis + candidate.leadTimeMinutes * MILLIS_PER_MINUTE;
      if (workingEnd <= leadCutoff) {
        removedByLeadTime += 1;
        continue;
      }
      if (workingStart < leadCutoff) {
        workingStart = leadCutoff;
      }

      const bookingCutoff = nowMillis + candidate.bookingWindowMinutes * MILLIS_PER_MINUTE;
      if (candidate.bookingWindowMinutes > 0 && workingStart >= bookingCutoff) {
        removedByBookingWindow += 1;
        continue;
      }
      if (candidate.bookingWindowMinutes > 0 && workingEnd > bookingCutoff) {
        workingEnd = bookingCutoff;
      }

      const minimumDuration = Math.max(requiredDuration, candidate.minDurationMin);
      if (minutesBetween(workingStart, workingEnd) < minimumDuration) {
        removedByDuration += 1;
        continue;
      }

      slots.push({
        startUtc: new Date(workingStart).toISOString(),
        endUtc: new Date(workingEnd).toISOString(),
        sourceRuleId: candidate.ruleId,
        confidence: 1
      });

      if (slots.length >= maxSlots) {
        break;
      }
    }

    if (slots.length >= maxSlots) {
      break;
    }
  }

  return {
    slots,
    metadata: {
      truncated: slots.length >= maxSlots,
      totalCandidateWindows: candidateWindows.length,
      removedByLeadTime,
      removedByBookingWindow,
      removedByConflicts,
      removedByDuration
    }
  };
}
