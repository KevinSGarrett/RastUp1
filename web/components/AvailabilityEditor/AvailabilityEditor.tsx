import React, { useCallback, useEffect, useMemo, useState } from 'react';

const WEEKDAYS = [
  { key: 'MON', label: 'Mon' },
  { key: 'TUE', label: 'Tue' },
  { key: 'WED', label: 'Wed' },
  { key: 'THU', label: 'Thu' },
  { key: 'FRI', label: 'Fri' },
  { key: 'SAT', label: 'Sat' },
  { key: 'SUN', label: 'Sun' }
] as const;

const DEFAULT_WEEKDAY_MASK = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4);
const DEFAULT_START_LOCAL = '09:00';
const DEFAULT_END_LOCAL = '17:00';

interface AvailabilityEditorStore {
  getState: () => any;
  subscribe: (listener: (state: any) => void) => () => void;
  recomputePreview: () => any;
  setWeeklyRule: (rule: any) => any;
  upsertException: (exception: any) => any;
  removeWeeklyRule: (ruleId: string) => any;
  removeException: (excId: string) => any;
  markClean: () => any;
  setPreviewRange: (range: { dateFrom: string; dateTo: string }) => any;
  setPreviewOptions: (options: Record<string, unknown>) => any;
}

export interface AvailabilityEditorProps {
  store: AvailabilityEditorStore;
  onSaveRules?: (state: any) => void;
  onRecompute?: (state: any) => void;
}

function formatTimeRange(slot: { startUtc: string; endUtc: string }) {
  const start = new Date(slot.startUtc);
  const end = new Date(slot.endUtc);
  return `${start.toUTCString()} → ${end.toUTCString()}`;
}

function makeTempId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function toggleWeekday(mask: number, weekdayKey: string, enabled: boolean) {
  const index = WEEKDAYS.findIndex((day) => day.key === weekdayKey);
  if (index === -1) {
    return mask;
  }
  if (enabled) {
    return mask | (1 << index);
  }
  return mask & ~(1 << index);
}

function maskToLabels(mask: number) {
  const labels: string[] = [];
  WEEKDAYS.forEach((day, index) => {
    if ((mask & (1 << index)) !== 0) {
      labels.push(day.label);
    }
  });
  return labels.length > 0 ? labels.join(', ') : 'None';
}

function coerceNumber(value: string | number | undefined, fallback: number) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function buildDefaultRule(state: any) {
  const template = state.weeklyRules?.[0] ?? {};
  const options = state.previewOptions ?? {};
  return {
    ruleId: makeTempId('wr_tmp'),
    userId: template.userId ?? 'local-user',
    roleCode: template.roleCode ?? 'default-role',
    weekdayMask: DEFAULT_WEEKDAY_MASK,
    startLocal: template.startLocal ?? DEFAULT_START_LOCAL,
    endLocal: template.endLocal ?? DEFAULT_END_LOCAL,
    timezone: template.timezone ?? 'UTC',
    minDurationMin: options.minDurationMin ?? template.minDurationMin ?? 60,
    leadTimeHours: options.leadTimeHours ?? template.leadTimeHours ?? 24,
    bookingWindowDays: options.bookingWindowDays ?? template.bookingWindowDays ?? 60,
    bufferBeforeMinutes: template.bufferBeforeMinutes ?? options.bufferBeforeMinutes ?? 0,
    bufferAfterMinutes: template.bufferAfterMinutes ?? options.bufferAfterMinutes ?? 0,
    active: true
  };
}

function buildDefaultException(state: any) {
  const template = state.weeklyRules?.[0] ?? {};
  const previewRange = state.previewRange ?? {};
  return {
    excId: makeTempId('ex_tmp'),
    userId: template.userId ?? 'local-user',
    dateLocal: previewRange.dateFrom ?? new Date().toISOString().slice(0, 10),
    timezone: template.timezone ?? 'UTC',
    kind: 'unavailable',
    note: ''
  };
}

export const AvailabilityEditor: React.FC<AvailabilityEditorProps> = ({
  store,
  onSaveRules,
  onRecompute
}) => {
  const [state, setState] = useState(() => store.getState());
  const [autoRecompute, setAutoRecompute] = useState(true);

  useEffect(() => store.subscribe(setState), [store]);

  useEffect(() => {
    if (autoRecompute) {
      store.recomputePreview();
    }
  }, [autoRecompute, store]);

  const previewSummary = useMemo(() => {
    const slots = state.previewSlots ?? [];
    const metadata = state.previewMetadata ?? {};
    return {
      total: slots.length,
      first: slots[0] ? formatTimeRange(slots[0]) : null,
      last: slots[slots.length - 1] ? formatTimeRange(slots[slots.length - 1]) : null,
      latencyMs: metadata.latencyMs ?? null,
      truncated: metadata.truncated ?? false
    };
  }, [state.previewSlots, state.previewMetadata]);

  const dirtyCount = useMemo(() => {
    const dirtyRules = state.dirtyWeeklyRuleIds?.length ?? 0;
    const dirtyExceptions = state.dirtyExceptionIds?.length ?? 0;
    return dirtyRules + dirtyExceptions;
  }, [state.dirtyWeeklyRuleIds, state.dirtyExceptionIds]);

  const handleRecompute = useCallback(() => {
    const next = store.recomputePreview();
    const snapshot = next ?? store.getState();
    setState(snapshot);
    onRecompute?.(snapshot);
  }, [store, onRecompute]);

  const handleSave = useCallback(() => {
    const snapshot = store.getState();
    onSaveRules?.(snapshot);
    store.markClean();
  }, [store, onSaveRules]);

  const handlePreviewRangeChange = useCallback(
    (key: 'dateFrom' | 'dateTo', value: string) => {
      const current = store.getState().previewRange ?? {};
      store.setPreviewRange({
        dateFrom: key === 'dateFrom' ? value : current.dateFrom ?? value,
        dateTo: key === 'dateTo' ? value : current.dateTo ?? value
      });
      if (autoRecompute) {
        store.recomputePreview();
      }
    },
    [store, autoRecompute]
  );

  const handlePreviewOptionChange = useCallback(
    (key: string, value: number) => {
      store.setPreviewOptions({ [key]: value });
      if (autoRecompute) {
        store.recomputePreview();
      }
    },
    [store, autoRecompute]
  );

  const handleRuleChange = useCallback(
    (ruleId: string, patch: Record<string, unknown>) => {
      store.setWeeklyRule({ ruleId, ...patch });
      if (autoRecompute) {
        store.recomputePreview();
      }
    },
    [store, autoRecompute]
  );

  const handleExceptionChange = useCallback(
    (excId: string, patch: Record<string, unknown>) => {
      store.upsertException({ excId, ...patch });
      if (autoRecompute) {
        store.recomputePreview();
      }
    },
    [store, autoRecompute]
  );

  const previewRange = state.previewRange ?? {
    dateFrom: new Date().toISOString().slice(0, 10),
    dateTo: new Date().toISOString().slice(0, 10)
  };
  const previewOptions = state.previewOptions ?? {};

  return (
    <section className="availability-editor">
      <header className="availability-editor__header">
        <div>
          <h2>Availability Rules</h2>
          <p className="availability-editor__description">
            Configure weekly templates, exceptions, lead times, and buffers, then preview feasible slots.
          </p>
        </div>
        <div className="availability-editor__header-controls">
          <label className="availability-editor__toggle">
            <input
              type="checkbox"
              checked={autoRecompute}
              onChange={(event) => setAutoRecompute(event.target.checked)}
            />{' '}
            Auto recompute preview
          </label>
          <div className="availability-editor__metrics">
            <span>Dirty changes: {dirtyCount}</span>
            <span>
              Last computed: {state.lastComputedAt ? new Date(state.lastComputedAt).toUTCString() : 'n/a'}
            </span>
            <span>
              Latency:{' '}
              {previewSummary.latencyMs != null ? `${Math.round(previewSummary.latencyMs)} ms` : 'n/a'}
            </span>
          </div>
          <div className="availability-editor__actions">
            <button type="button" onClick={handleRecompute}>
              Recompute Preview
            </button>
            <button type="button" onClick={handleSave} disabled={dirtyCount === 0}>
              Save Changes
            </button>
          </div>
        </div>
      </header>

      <div className="availability-editor__config">
        <fieldset className="availability-editor__fieldset">
          <legend>Preview Range</legend>
          <label>
            From
            <input
              type="date"
              value={previewRange.dateFrom}
              onChange={(event) => handlePreviewRangeChange('dateFrom', event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={previewRange.dateTo}
              onChange={(event) => handlePreviewRangeChange('dateTo', event.target.value)}
            />
          </label>
        </fieldset>

        <fieldset className="availability-editor__fieldset">
          <legend>Preview Options</legend>
          <label>
            Lead time (hours)
            <input
              type="number"
              min={0}
              value={previewOptions.leadTimeHours ?? 24}
              onChange={(event) =>
                handlePreviewOptionChange('leadTimeHours', coerceNumber(event.target.value, 24))
              }
            />
          </label>
          <label>
            Booking window (days)
            <input
              type="number"
              min={1}
              value={previewOptions.bookingWindowDays ?? 60}
              onChange={(event) =>
                handlePreviewOptionChange('bookingWindowDays', coerceNumber(event.target.value, 60))
              }
            />
          </label>
          <label>
            Minimum duration (minutes)
            <input
              type="number"
              min={15}
              value={previewOptions.minDurationMin ?? 60}
              onChange={(event) =>
                handlePreviewOptionChange('minDurationMin', coerceNumber(event.target.value, 60))
              }
            />
          </label>
          <label>
            Requested duration (minutes)
            <input
              type="number"
              min={15}
              value={previewOptions.requestedDurationMin ?? previewOptions.minDurationMin ?? 60}
              onChange={(event) =>
                handlePreviewOptionChange(
                  'requestedDurationMin',
                  coerceNumber(event.target.value, previewOptions.minDurationMin ?? 60)
                )
              }
            />
          </label>
          <label>
            Buffer before (minutes)
            <input
              type="number"
              min={0}
              value={previewOptions.bufferBeforeMinutes ?? 0}
              onChange={(event) =>
                handlePreviewOptionChange('bufferBeforeMinutes', coerceNumber(event.target.value, 0))
              }
            />
          </label>
          <label>
            Buffer after (minutes)
            <input
              type="number"
              min={0}
              value={previewOptions.bufferAfterMinutes ?? 0}
              onChange={(event) =>
                handlePreviewOptionChange('bufferAfterMinutes', coerceNumber(event.target.value, 0))
              }
            />
          </label>
          <label>
            Slot granularity (minutes)
            <input
              type="number"
              min={5}
              value={previewOptions.slotGranularityMinutes ?? 30}
              onChange={(event) =>
                handlePreviewOptionChange(
                  'slotGranularityMinutes',
                  coerceNumber(event.target.value, 30)
                )
              }
            />
          </label>
          <label>
            Max slots
            <input
              type="number"
              min={1}
              value={previewOptions.maxSlots ?? 100}
              onChange={(event) =>
                handlePreviewOptionChange('maxSlots', coerceNumber(event.target.value, 100))
              }
            />
          </label>
        </fieldset>
      </div>

      <div className="availability-editor__content">
        <div className="availability-editor__column availability-editor__column--rules">
          <h3>Weekly Rules</h3>
          <button
            type="button"
            className="availability-editor__add"
            onClick={() => {
              const draft = buildDefaultRule(store.getState());
              store.setWeeklyRule(draft);
              if (autoRecompute) {
                store.recomputePreview();
              }
            }}
          >
            + Add weekly rule
          </button>
          <ul>
            {(state.weeklyRules ?? []).map((rule: any) => (
              <li key={rule.ruleId} className="availability-editor__rule">
                <header className="availability-editor__rule-header">
                  <strong>{rule.roleCode ?? 'unspecified'}</strong>
                  <span className="availability-editor__rule-weekdays">
                    {maskToLabels(rule.weekdayMask ?? 0)}
                  </span>
                  <label>
                    <input
                      type="checkbox"
                      checked={rule.active !== false}
                      onChange={(event) => handleRuleChange(rule.ruleId, { active: event.target.checked })}
                    />{' '}
                    Active
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      store.removeWeeklyRule(rule.ruleId);
                      if (autoRecompute) {
                        store.recomputePreview();
                      }
                    }}
                  >
                    Remove
                  </button>
                </header>
                <div className="availability-editor__rule-grid">
                  <label>
                    Role code
                    <input
                      type="text"
                      value={rule.roleCode ?? ''}
                      onChange={(event) => handleRuleChange(rule.ruleId, { roleCode: event.target.value })}
                    />
                  </label>
                  <label>
                    Timezone
                    <input
                      type="text"
                      value={rule.timezone ?? ''}
                      onChange={(event) => handleRuleChange(rule.ruleId, { timezone: event.target.value })}
                      placeholder="America/Los_Angeles"
                    />
                  </label>
                  <label>
                    Start
                    <input
                      type="time"
                      value={rule.startLocal ?? DEFAULT_START_LOCAL}
                      onChange={(event) => handleRuleChange(rule.ruleId, { startLocal: event.target.value })}
                    />
                  </label>
                  <label>
                    End
                    <input
                      type="time"
                      value={rule.endLocal ?? DEFAULT_END_LOCAL}
                      onChange={(event) => handleRuleChange(rule.ruleId, { endLocal: event.target.value })}
                    />
                  </label>
                  <label>
                    Lead time (h)
                    <input
                      type="number"
                      min={0}
                      value={rule.leadTimeHours ?? previewOptions.leadTimeHours ?? 24}
                      onChange={(event) =>
                        handleRuleChange(rule.ruleId, {
                          leadTimeHours: coerceNumber(event.target.value, 24)
                        })
                      }
                    />
                  </label>
                  <label>
                    Booking window (d)
                    <input
                      type="number"
                      min={1}
                      value={rule.bookingWindowDays ?? previewOptions.bookingWindowDays ?? 60}
                      onChange={(event) =>
                        handleRuleChange(rule.ruleId, {
                          bookingWindowDays: coerceNumber(event.target.value, 60)
                        })
                      }
                    />
                  </label>
                  <label>
                    Min duration (min)
                    <input
                      type="number"
                      min={15}
                      value={rule.minDurationMin ?? previewOptions.minDurationMin ?? 60}
                      onChange={(event) =>
                        handleRuleChange(rule.ruleId, {
                          minDurationMin: coerceNumber(event.target.value, 60)
                        })
                      }
                    />
                  </label>
                  <label>
                    Buffer before (min)
                    <input
                      type="number"
                      min={0}
                      value={rule.bufferBeforeMinutes ?? previewOptions.bufferBeforeMinutes ?? 0}
                      onChange={(event) =>
                        handleRuleChange(rule.ruleId, {
                          bufferBeforeMinutes: coerceNumber(event.target.value, 0)
                        })
                      }
                    />
                  </label>
                  <label>
                    Buffer after (min)
                    <input
                      type="number"
                      min={0}
                      value={rule.bufferAfterMinutes ?? previewOptions.bufferAfterMinutes ?? 0}
                      onChange={(event) =>
                        handleRuleChange(rule.ruleId, {
                          bufferAfterMinutes: coerceNumber(event.target.value, 0)
                        })
                      }
                    />
                  </label>
                </div>
                <div className="availability-editor__weekday-picker">
                  {WEEKDAYS.map((weekday, index) => (
                    <label key={`${rule.ruleId}_${weekday.key}`}>
                      <input
                        type="checkbox"
                        checked={Boolean((rule.weekdayMask ?? 0) & (1 << index))}
                        onChange={(event) =>
                          handleRuleChange(rule.ruleId, {
                            weekdayMask: toggleWeekday(
                              rule.weekdayMask ?? 0,
                              weekday.key,
                              event.target.checked
                            )
                          })
                        }
                      />{' '}
                      {weekday.label}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="availability-editor__column availability-editor__column--exceptions">
          <h3>Exceptions & Blackouts</h3>
          <button
            type="button"
            className="availability-editor__add"
            onClick={() => {
              const draft = buildDefaultException(store.getState());
              store.upsertException(draft);
              if (autoRecompute) {
                store.recomputePreview();
              }
            }}
            >
              + Add exception
            </button>
            <ul>
              {(state.exceptions ?? []).map((exception: any) => {
                const isAllDay = !exception.startLocal && !exception.endLocal;
                return (
                  <li key={exception.excId} className="availability-editor__exception">
                    <header className="availability-editor__exception-header">
                      <strong>{exception.kind?.toUpperCase() ?? 'UNKNOWN'}</strong>
                      <span>{exception.dateLocal}</span>
                      <button
                        type="button"
                        onClick={() => {
                          store.removeException(exception.excId);
                          if (autoRecompute) {
                            store.recomputePreview();
                          }
                        }}
                      >
                        Remove
                      </button>
                    </header>
                    <div className="availability-editor__exception-grid">
                      <label>
                        Kind
                        <select
                          value={exception.kind ?? 'unavailable'}
                          onChange={(event) =>
                            handleExceptionChange(exception.excId, { kind: event.target.value })
                          }
                        >
                          <option value="available">Available override</option>
                          <option value="unavailable">Unavailable / blackout</option>
                        </select>
                      </label>
                      <label>
                        Date
                        <input
                          type="date"
                          value={exception.dateLocal ?? ''}
                          onChange={(event) =>
                            handleExceptionChange(exception.excId, { dateLocal: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Timezone
                        <input
                          type="text"
                          value={exception.timezone ?? ''}
                          onChange={(event) =>
                            handleExceptionChange(exception.excId, { timezone: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        All day
                        <input
                          type="checkbox"
                          disabled={exception.kind === 'available'}
                          checked={exception.kind === 'available' ? false : isAllDay}
                          onChange={(event) => {
                            if (event.target.checked) {
                              handleExceptionChange(exception.excId, {
                                startLocal: null,
                                endLocal: null
                              });
                            } else {
                              handleExceptionChange(exception.excId, {
                                startLocal: exception.startLocal ?? DEFAULT_START_LOCAL,
                                endLocal: exception.endLocal ?? DEFAULT_END_LOCAL
                              });
                            }
                          }}
                        />
                      </label>
                      <label>
                        Start
                        <input
                          type="time"
                          disabled={exception.kind !== 'available' && isAllDay}
                          value={exception.startLocal ?? DEFAULT_START_LOCAL}
                          onChange={(event) =>
                            handleExceptionChange(exception.excId, { startLocal: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        End
                        <input
                          type="time"
                          disabled={exception.kind !== 'available' && isAllDay}
                          value={exception.endLocal ?? DEFAULT_END_LOCAL}
                          onChange={(event) =>
                            handleExceptionChange(exception.excId, { endLocal: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Note
                        <input
                          type="text"
                          value={exception.note ?? ''}
                          onChange={(event) =>
                            handleExceptionChange(exception.excId, { note: event.target.value })
                          }
                          placeholder="Optional note"
                        />
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
        </div>

        <div className="availability-editor__column availability-editor__column--preview">
          <h3>Preview Slots</h3>
          <p>
            {previewSummary.total} slots{' '}
            {previewSummary.first ? `(first: ${previewSummary.first})` : null}{' '}
            {previewSummary.last ? `(last: ${previewSummary.last})` : null}
            {previewSummary.truncated ? ' · truncated to max slots' : null}
          </p>
          <ol>
            {(state.previewSlots ?? []).slice(0, 10).map((slot: any, index: number) => (
              <li key={slot.sourceRuleId ?? slot.startUtc ?? index}>
                <div>{formatTimeRange(slot)}</div>
                {slot.sourceRuleId ? (
                  <div className="availability-editor__slot-meta">Rule: {slot.sourceRuleId}</div>
                ) : null}
              </li>
            ))}
          </ol>
          {state.previewSlots?.length > 10 ? (
            <p className="availability-editor__preview-more">
              Showing first 10 of {state.previewSlots.length}. Narrow the window or adjust granularity to inspect more.
            </p>
          ) : null}
          {state.previewError ? (
            <p className="availability-editor__error">Preview error: {state.previewError}</p>
          ) : (
            <p className="availability-editor__meta">
              Holds: {state.holds?.length ?? 0} · Confirmed events: {state.confirmedEvents?.length ?? 0} · External busy:{' '}
              {state.externalBusy?.length ?? 0}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
