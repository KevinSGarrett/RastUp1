import {
  iterateDates,
  getWeekday,
  maskIncludesWeekday,
  mergeIntervals,
  zonedDateTimeToEpochMs,
  subtractIntervals
} from './time.mjs';

const MIN_DURATION_MINUTES = 15;

function toInterval({ dateLocal, startLocal, endLocal, timezone, meta }) {
  if (!startLocal || !endLocal) {
    throw new Error(`Missing start/end for interval on ${dateLocal}`);
  }
  const start = zonedDateTimeToEpochMs(dateLocal, startLocal, timezone);
  const end = zonedDateTimeToEpochMs(dateLocal, endLocal, timezone);
  if (end <= start) {
    throw new Error(`End must be after start for ${dateLocal} ${startLocal}-${endLocal}`);
  }
  return {
    start,
    end,
    meta
  };
}

/**
 * Expands weekly rules into UTC intervals across a date range.
 * @param {Array<{
 *   ruleId: string;
 *   weekdayMask: number;
 *   startLocal: string;
 *   endLocal: string;
 *   timezone: string;
 *   active?: boolean;
 * }>} rules
 * @param {{ dateFrom: string; dateTo: string }}
 */
export function expandWeeklyRules(rules, { dateFrom, dateTo }) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return [];
  }
  const intervals = [];
  for (const rule of rules) {
    if (rule.active === false) {
      continue;
    }
    if (!rule.timezone) {
      throw new Error(`Rule ${rule.ruleId} missing timezone`);
    }
    for (const dateLocal of iterateDates(dateFrom, dateTo)) {
      const weekday = getWeekday(dateLocal, rule.timezone);
      if (!maskIncludesWeekday(rule.weekdayMask, weekday)) {
        continue;
      }
      const interval = toInterval({
        dateLocal,
        startLocal: rule.startLocal,
        endLocal: rule.endLocal,
        timezone: rule.timezone,
        meta: {
          type: 'weekly_rule',
          ruleId: rule.ruleId
        }
      });
      intervals.push(interval);
    }
  }
  return mergeIntervals(intervals);
}

function dayBoundsEpoch(dateLocal, timezone) {
  const start = zonedDateTimeToEpochMs(dateLocal, '00:00', timezone);
  const end = zonedDateTimeToEpochMs(dateLocal, '23:59', timezone) + 60 * 1000;
  return { start, end };
}

/**
 * Applies availability exceptions to a list of intervals.
 * @param {Array<{ start: number; end: number; meta?: any }>} intervals
 * @param {Array<{
 *   excId: string;
 *   dateLocal: string;
 *   timezone: string;
 *   kind: 'available'|'unavailable';
 *   startLocal?: string;
 *   endLocal?: string;
 * }>} exceptions
 */
export function applyExceptions(intervals, exceptions) {
  if (!Array.isArray(exceptions) || exceptions.length === 0) {
    return mergeIntervals(intervals);
  }
  let output = mergeIntervals(intervals);
  for (const exception of exceptions) {
    const zone = exception.timezone;
    if (!zone) {
      throw new Error(`Exception ${exception.excId} missing timezone`);
    }
    const bounds = exception.startLocal && exception.endLocal
      ? toInterval({
        dateLocal: exception.dateLocal,
        startLocal: exception.startLocal,
        endLocal: exception.endLocal,
        timezone: zone,
        meta: { type: 'exception', excId: exception.excId, kind: exception.kind }
      })
      : dayBoundsEpoch(exception.dateLocal, zone);
    if (exception.kind === 'unavailable') {
      output = subtractIntervals(output, [bounds]);
    } else if (exception.kind === 'available') {
      if (!exception.startLocal || !exception.endLocal) {
        throw new Error(`Available exception ${exception.excId} must include start/end`);
      }
      output = mergeIntervals([
        ...output,
        {
          start: bounds.start,
          end: bounds.end,
          meta: { type: 'exception', excId: exception.excId, kind: 'available' }
        }
      ]);
    } else {
      throw new Error(`Unknown exception kind: ${exception.kind}`);
    }
  }
  return output.filter((interval) => (interval.end - interval.start) / (60 * 1000) >= MIN_DURATION_MINUTES);
}
