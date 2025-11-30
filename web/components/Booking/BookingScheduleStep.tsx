'use client';

interface AvailabilityEntry {
  date: string;
  slots: string[];
}

interface BookingScheduleStepProps {
  availability: AvailabilityEntry[];
  selectedSlot: { date: string; slot: string } | null;
  onSelectSlot: (date: string, slot: string) => void;
}

function formatDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' });
}

export function BookingScheduleStep({ availability, selectedSlot, onSelectSlot }: BookingScheduleStepProps) {
  if (!availability.length) {
    return (
      <section className="booking-step booking-step--schedule" aria-labelledby="booking-step-schedule-title">
        <h2 id="booking-step-schedule-title" className="booking-step__title">
          Schedule session
        </h2>
        <p className="booking-step__description">No availability published. Reach out to request custom scheduling.</p>
      </section>
    );
  }

  return (
    <section className="booking-step booking-step--schedule" aria-labelledby="booking-step-schedule-title">
      <h2 id="booking-step-schedule-title" className="booking-step__title">
        Schedule session
      </h2>
      <p className="booking-step__description">Select a date and time that works for you. All times local to the talent.</p>
      <div className="booking-schedule">
        {availability.map((entry) => (
          <div key={entry.date} className="booking-schedule__day">
            <h3 className="booking-schedule__day-title">{formatDate(entry.date)}</h3>
            <ul className="booking-schedule__slots">
              {entry.slots.map((slot) => {
                const isSelected = selectedSlot?.date === entry.date && selectedSlot?.slot === slot;
                return (
                  <li key={`${entry.date}-${slot}`}>
                    <button
                      type="button"
                      className={`booking-schedule__slot${isSelected ? ' booking-schedule__slot--selected' : ''}`}
                      onClick={() => onSelectSlot(entry.date, slot)}
                    >
                      {slot}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
