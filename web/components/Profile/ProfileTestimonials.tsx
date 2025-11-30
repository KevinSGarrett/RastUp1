'use client';

interface ProfileTestimonial {
  id?: string | null;
  reviewer?: string | null;
  rating?: number | null;
  quote?: string | null;
  createdAt?: string | null;
}

interface ProfileTestimonialsProps {
  testimonials: ProfileTestimonial[];
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

export function ProfileTestimonials({ testimonials }: ProfileTestimonialsProps) {
  if (!testimonials.length) {
    return null;
  }

  return (
    <section className="profile-testimonials" aria-label="Testimonials">
      <h2 className="profile-testimonials__title">Testimonials</h2>
      <ul className="profile-testimonials__list">
        {testimonials.map((testimonial) => (
          <li key={testimonial.id ?? testimonial.reviewer ?? testimonial.quote ?? 'testimonial'} className="profile-testimonials__item">
            <blockquote className="profile-testimonials__quote">
              “{testimonial.quote}”
            </blockquote>
            <footer className="profile-testimonials__footer">
              <span className="profile-testimonials__reviewer">{testimonial.reviewer ?? 'Client'}</span>
              {testimonial.rating != null ? (
                <span className="profile-testimonials__rating" aria-label={`Rated ${testimonial.rating} out of 5`}>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <span
                      key={index}
                      className={
                        index < (testimonial.rating ?? 0)
                          ? 'profile-testimonials__star profile-testimonials__star--filled'
                          : 'profile-testimonials__star'
                      }
                      aria-hidden="true"
                    >
                      ★
                    </span>
                  ))}
                </span>
              ) : null}
              {formatDate(testimonial.createdAt) ? (
                <time dateTime={testimonial.createdAt ?? undefined} className="profile-testimonials__date">
                  {formatDate(testimonial.createdAt)}
                </time>
              ) : null}
            </footer>
          </li>
        ))}
      </ul>
    </section>
  );
}
