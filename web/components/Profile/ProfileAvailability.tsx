'use client';

interface ProfileAvailabilityProps {
  availability: string[];
}

export function ProfileAvailability({ availability }: ProfileAvailabilityProps) {
  if (!availability.length) {
    return null;
  }

  return (
    <section className="profile-availability" aria-label="Upcoming availability">
      <h2 className="profile-availability__title">Upcoming availability</h2>
      <ul className="profile-availability__list">
        {availability.slice(0, 6).map((date) => (
          <li key={date} className="profile-availability__item">
            <time dateTime={date}>{new Date(date).toLocaleDateString()}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
