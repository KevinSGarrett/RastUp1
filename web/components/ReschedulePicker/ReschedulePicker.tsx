import React, { useEffect, useState } from 'react';

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
}

function renderSlot(slot: any) {
  const start = new Date(slot.startUtc);
  const end = new Date(slot.endUtc);
  return `${start.toUTCString()} → ${end.toUTCString()} (${slot.durationMinutes ?? 0} minutes)`;
}

export const ReschedulePicker: React.FC<ReschedulePickerProps> = ({
  store,
  onSelectSlot,
  onSubmitHold
}) => {
  const [state, setState] = useState(() => store.getState());

  useEffect(() => store.subscribe(setState), [store]);

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

  return (
    <section className="reschedule-picker">
      <header className="reschedule-picker__header">
        <h2>Reschedule Picker</h2>
        <p>Select a new slot that satisfies lead time and duration requirements.</p>
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
          </span>
        ) : null}
      </footer>
    </section>
  );
};
