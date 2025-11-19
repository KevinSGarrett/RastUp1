import { expandWeeklyRules, applyExceptions } from './availability.mjs';
import {
  mergeIntervals,
  subtractIntervals,
  addMinutes,
  toIsoString
} from './time.mjs';

function toBusyInterval(entry, options = {}) {
  const start = Date.parse(entry.startUtc ?? entry.start);
  const end = Date.parse(entry.endUtc ?? entry.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('Invalid busy interval');
  }
  const before = (options.bufferBeforeMinutes ?? 0) * 60 * 1000;
  const after = (options.bufferAfterMinutes ?? 0) * 60 * 1000;
  return {
    start: start - before,
    end: end + after,
    meta: entry.meta
  };
}

function toBusyIntervals(entries, bufferBeforeMinutes, bufferAfterMinutes) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  return entries.map((entry) => toBusyInterval(entry, { bufferBeforeMinutes, bufferAfterMinutes }));
}

function enforceMinDuration(intervals, minDurationMinutes) {
  const minMs = minDurationMinutes * 60 * 1000;
  return intervals.filter((interval) => interval.end - interval.start >= minMs);
}

/**
 * Computes feasible slots given rules, exceptions, and busy intervals.
 * @param {{
 *   rules: Array<any>;
 *   exceptions?: Array<any>;
 *   holds?: Array<{ startUtc: string; endUtc: string }>;
 *   events?: Array<{ startUtc: string; endUtc: string }>;
 *   externalBusy?: Array<{ startUtc: string; endUtc: string }>;
 *   dateFrom: string;
 *   dateTo: string;
 *   now?: string|number|Date;
 *   leadTimeHours?: number;
 *   bookingWindowDays?: number;
 *   minDurationMin?: number;
 *   requestedDurationMin?: number;
 *   bufferBeforeMinutes?: number;
 *   bufferAfterMinutes?: number;
 *   slotGranularityMinutes?: number;
 *   maxSlots?: number;
 * }} input
 * @returns {Array<{ startUtc: string; endUtc: string }>}
 */
export function computeFeasibleSlots(input) {
  const {
    rules,
    exceptions = [],
    holds = [],
    events = [],
    externalBusy = [],
    dateFrom,
    dateTo,
    now = Date.now(),
    leadTimeHours = 24,
    bookingWindowDays = 60,
    minDurationMin = 60,
    requestedDurationMin,
    bufferBeforeMinutes = 0,
    bufferAfterMinutes = 0,
    slotGranularityMinutes,
    maxSlots = 100
  } = input;

  const baseIntervals = expandWeeklyRules(rules, { dateFrom, dateTo });
  const withExceptions = applyExceptions(baseIntervals, exceptions);

  const busyIntervals = mergeIntervals([
    ...toBusyIntervals(holds, bufferBeforeMinutes, bufferAfterMinutes),
    ...toBusyIntervals(events, bufferBeforeMinutes, bufferAfterMinutes),
    ...toBusyIntervals(externalBusy, bufferBeforeMinutes, bufferAfterMinutes)
  ]);

  const freeIntervals = subtractIntervals(withExceptions, busyIntervals);

  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  const leadThreshold = addMinutes(nowMs, leadTimeHours * 60);
  const windowEnd = addMinutes(nowMs, bookingWindowDays * 24 * 60);

  const minDuration = Math.max(minDurationMin, requestedDurationMin ?? minDurationMin);
  const durationMs = minDuration * 60 * 1000;
  const stepMinutes = slotGranularityMinutes ?? Math.min(30, minDuration);
  const stepMs = Math.max(stepMinutes, 5) * 60 * 1000;

  const trimmed = enforceMinDuration(
    freeIntervals.map((interval) => ({
      start: Math.max(interval.start, leadThreshold),
      end: Math.min(interval.end, windowEnd)
    })),
    minDuration
  ).filter((interval) => interval.end > interval.start);

  const slots = [];
  for (const interval of trimmed) {
    let cursor = interval.start;
    while (cursor + durationMs <= interval.end + 1000) {
      const slotStart = cursor;
      const slotEnd = slotStart + durationMs;
      if (slotEnd > interval.end) {
        break;
      }
      slots.push({
        startUtc: toIsoString(slotStart),
        endUtc: toIsoString(slotEnd)
      });
      if (slots.length >= maxSlots) {
        return slots;
      }
      cursor += stepMs;
    }
  }
  return slots;
}
