import React, { useEffect, useMemo, useState } from 'react';

interface ReschedulePickerStore {
  getState: () => any;
  subscribe: (listener: (state: any) => void) => () => void;
  loadSlots: (input: any) => any;
  setFilters: (filters: any) => any;
  setDuration: (durationMin: number) => any;
  selectSlot: (slotId: string | null) => any;
  recordHoldResult: (result: any) => any;
}

export interface ReschedulePickerProps {
  store: ReschedulePickerStore;
  onSelectSlot?: (slot: any | null) => void;
  onSubmitHold?: (state: any) => void;
  onRefresh?: () => void;
}

function renderSlot(slot: any) {
  const start = new Date(slot.startUtc);
  const end = new Date(slot.endUtc);
  return `${start.toUTCString()} → ${end.toUTCString()} (${slot.durationMinutes ?? 0} minutes)`;
}

function formatCountdown(expiresAt?: string | null) {
  if (!expiresAt) {
    return null;
  }
  const target = Date.parse(expiresAt);
  if (!Number.isFinite(target)) {
    return null;
  }
  const diffMs = target - Date.now();
  if (diffMs <= 0) {
    return 'expired';
  }
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  return `${minutes}m ${seconds}s remaining`;
}

export const ReschedulePicker: React.FC<ReschedulePickerProps> = ({
  store,
  onSelectSlot,
  onSubmitHold,
  onRefresh
}) => {
  const [state, setState] = useState(() => store.getState());
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => store.subscribe(setState), [store]);

  useEffect(() => {
    if (!state.holdStatus?.expiresAt) {
      return undefined;
    }
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.holdStatus?.expiresAt]);

  useEffect(() => {
    if (!state.metadata?.lastRecomputedAt) {
      return;
    }
    // trigger tick update to refresh countdown formatting without manual action
    setTick(Date.now());
  }, [state.metadata?.lastRecomputedAt]);

  const handleSelect = (slotId: string) => {
    store.selectSlot(slotId);
    onSelectSlot?.(store.getState().selection ?? null);
  };

  const handleSubmit = () => {
    const selection = store.getState().selection;
    if (!selection) {
      return;
    }
    store.recordHoldResult({
      holdId: `pending_${selection.slotId}`,
      status: 'pending',
      expiresAt: selection.endUtc
    });
    onSubmitHold?.(store.getState());
  };

  const metadata = state.metadata ?? {};
  const holdCountdown = useMemo(() => formatCountdown(state.holdStatus?.expiresAt), [state.holdStatus, tick]);

  return (
    <section className="reschedule-picker">
      <header className="reschedule-picker__header">
        <h2>Reschedule Picker</h2>
        <p>
          Select a new slot that satisfies lead time and duration requirements. Showing{' '}
          {metadata.filteredCount ?? state.filteredSlots?.length ?? 0} of {metadata.totalSourceSlots ?? 0} slots.
        </p>
        <div className="reschedule-picker__header-actions">
          <button
            type="button"
            onClick={() =>
              store.loadSlots({
                slots: state.sourceSlots,
                durationMin: state.durationMin,
                nowUtc: state.now
              })
            }
          >
            Reapply filters
          </button>
          <button type="button" onClick={() => onRefresh?.()}>
            Refresh slots
          </button>
          <span className="reschedule-picker__timestamp">
            Last recomputed: {metadata.lastRecomputedAt ? new Date(metadata.lastRecomputedAt).toUTCString() : 'n/a'}
          </span>
        </div>
      </header>

      <div className="reschedule-picker__controls">
        <label>
          Duration (minutes)
          <input
            type="number"
            min={15}
            value={state.durationMin}
            onChange={(event) => store.setDuration(Number(event.target.value))}
          />
        </label>
        <label>
          Day filter
          <select
            value={state.filters.day}
            onChange={(event) => store.setFilters({ day: event.target.value })}
          >
            <option value="ANY">Any day</option>
            <option value="WEEKDAY">Weekday</option>
            <option value="WEEKEND">Weekend</option>
          </select>
        </label>
        <label>
          Time of day
          <select
            value={state.filters.timeOfDay}
            onChange={(event) => store.setFilters({ timeOfDay: event.target.value })}
          >
            <option value="ANY">Any time</option>
            <option value="MORNING">Morning</option>
            <option value="AFTERNOON">Afternoon</option>
            <option value="EVENING">Evening</option>
            <option value="NIGHT">Night</option>
          </select>
        </label>
      </div>

      <ol className="reschedule-picker__slots">
        {(state.filteredSlots ?? []).map((slot: any) => (
          <li
            key={slot.slotId}
            className={
              state.selection?.slotId === slot.slotId
                ? 'reschedule-picker__slot reschedule-picker__slot--selected'
                : 'reschedule-picker__slot'
            }
          >
            <button type="button" onClick={() => handleSelect(slot.slotId)}>
              {renderSlot(slot)}
            </button>
          </li>
        ))}
      </ol>

      <footer className="reschedule-picker__footer">
        <button type="button" onClick={handleSubmit} disabled={!state.selection}>
          Create Hold
        </button>
        {state.holdStatus ? (
          <span className="reschedule-picker__hold-status">
            Hold {state.holdStatus.holdId} — {state.holdStatus.status}
            {holdCountdown ? ` (${holdCountdown})` : ''}
          </span>
        ) : null}
      </footer>
    </section>
  );
};
