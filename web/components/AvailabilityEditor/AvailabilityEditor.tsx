import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface AvailabilityEditorStore {
  getState: () => any;
  subscribe: (listener: (state: any) => void) => () => void;
  recomputePreview: () => any;
  setWeeklyRule: (rule: any) => any;
  upsertException: (exception: any) => any;
  removeWeeklyRule: (ruleId: string) => any;
  removeException: (excId: string) => any;
  markClean: () => any;
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

export const AvailabilityEditor: React.FC<AvailabilityEditorProps> = ({
  store,
  onSaveRules,
  onRecompute
}) => {
  const [state, setState] = useState(() => store.getState());

  useEffect(() => store.subscribe(setState), [store]);

  const previewSummary = useMemo(() => {
    const slots = state.previewSlots ?? [];
    return {
      total: slots.length,
      first: slots[0] ? formatTimeRange(slots[0]) : null,
      last: slots[slots.length - 1] ? formatTimeRange(slots[slots.length - 1]) : null
    };
  }, [state.previewSlots]);

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

  return (
    <section className="availability-editor">
      <header className="availability-editor__header">
        <div>
          <h2>Availability Rules</h2>
          <p className="availability-editor__description">
            Configure weekly templates, exceptions, and preview feasible slots before publishing.
          </p>
        </div>
        <div className="availability-editor__actions">
          <button type="button" onClick={handleRecompute}>
            Recompute Preview
          </button>
          <button type="button" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      </header>

      <div className="availability-editor__content">
        <div className="availability-editor__column availability-editor__column--rules">
          <h3>Weekly Rules</h3>
          <ul>
            {(state.weeklyRules ?? []).map((rule: any) => (
              <li key={rule.ruleId}>
                <div>
                  <strong>{rule.roleCode}</strong> — {rule.startLocal} → {rule.endLocal}{' '}
                  ({rule.timezone})
                </div>
                <div className="availability-editor__rule-meta">
                  Lead time: {rule.leadTimeHours}h · Window: {rule.bookingWindowDays}d · Min duration:{' '}
                  {rule.minDurationMin}m
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="availability-editor__column availability-editor__column--exceptions">
          <h3>Exceptions</h3>
          <ul>
            {(state.exceptions ?? []).map((exception: any) => (
              <li key={exception.excId}>
                <strong>{exception.kind.toUpperCase()}</strong> — {exception.dateLocal}{' '}
                {exception.startLocal ? `${exception.startLocal} → ${exception.endLocal}` : '(all-day)'}{' '}
                ({exception.timezone})
              </li>
            ))}
          </ul>
        </div>

        <div className="availability-editor__column availability-editor__column--preview">
          <h3>Preview Slots</h3>
          <p>
            {previewSummary.total} slots{' '}
            {previewSummary.first ? `(first: ${previewSummary.first})` : null}{' '}
            {previewSummary.last ? `(last: ${previewSummary.last})` : null}
          </p>
          <ol>
            {(state.previewSlots ?? []).slice(0, 8).map((slot: any, index: number) => (
              <li key={slot.sourceRuleId ?? index}>{formatTimeRange(slot)}</li>
            ))}
          </ol>
          {state.previewSlots?.length > 8 ? (
            <p className="availability-editor__preview-more">
              Showing first 8 slots of {state.previewSlots.length}. Refine filters to narrow results.
            </p>
          ) : null}
          {state.previewError ? (
            <p className="availability-editor__error">Preview error: {state.previewError}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
};
