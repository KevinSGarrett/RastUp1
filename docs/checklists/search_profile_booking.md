# Vertical Checklist: Search → Profile → Booking → Signup → Payment

_Last updated: 2025-11-26_

Status legend:  
- `[ ]` not started  
- `[~]` in progress / partially implemented  
- `[x]` done (code + tests in repo)

This checklist is the “requirements view” for the main customer flow:
**search talent → view profile → book → signup/login → pay**.

---

## 1. Search

### 1.1 Inputs & filters

- [~] Free-text query `q` (name / tags / bio)
- [~] Surface switch: PEOPLE vs STUDIOS
- [~] Role filter (MODEL / PHOTOGRAPHER / VIDEOGRAPHER / CREATOR / FANSUB)
- [ ] Location filters (city / region / country)
- [ ] Price range (min / max or hourly/day rate)
- [~] Safe-Mode toggle and enforcement
- [ ] Availability filter (has bookable slots in window)
- [~] Sort: relevance, price asc/desc, rating, newest

### 1.2 Results & UX

- [ ] Result card shows: name, role, city, headline, price, rating, tags
- [~] Safe-Mode hides/softens sensitive media in thumbnails
- [ ] Empty state for no matches (with suggestions)
- [~] Error state for backend failures
- [~] “Load more” / paging works

### 1.3 SEO & telemetry

- [ ] Basic SEO tags for `/search`
- [~] Telemetry events: `search:surface_change`, `search:query_input`,
      `search:filter_change`, `search:load_more`

### 1.4 Tests

- [x] Store-level unit tests for search store, filters, serialization
- [~] Playwright smoke test: basic search + click through to profile

---

## 2. Profile

### 2.1 Data fields

- [~] Display name, headline, bio
- [~] Roles (MODEL / PHOTOGRAPHER / …) and `activeRole`
- [~] Location (city / region / country)
- [~] Languages
- [~] Tags / specialties
- [~] Rating and review count
- [ ] Hourly / day rate surfaced consistently
- [ ] Social links surfaced where appropriate

### 2.2 UX & layout

- [~] Hero section with hero image, Safe-Mode handling
- [~] Role tabs switch `activeRole`
- [~] About section with tags and completeness segments
- [~] Packages section for bookable offerings
- [~] Gallery section (Safe-Mode filtering)
- [~] Testimonials section
- [ ] Mobile layout polish (spacing, stacking, tap targets)

### 2.3 Safety & Safe-Mode

- [~] Safe-Mode toggle on profile
- [~] Safe-Mode hides or blurs sensitive media (using band thresholds)
- [ ] UX copy clearly explains Safe-Mode behavior

### 2.4 Tests

- [x] Store-level tests for profile store
- [ ] Component tests for critical profile UI pieces

---

## 3. Booking

### 3.1 Packages & pricing

- [~] Packages exposed from backend (name, description, price, duration)
- [~] Add-ons with price deltas
- [~] Price breakdown: base, add-ons, subtotal, taxes, fees, total
- [ ] Clear indication of currency + tax rules

### 3.2 Availability & scheduling

- [~] Availability buckets (date + slots) loaded for a service profile
- [~] User can pick a date and time slot
- [ ] Validation for past dates / slots disabled

### 3.3 Documents & contracts

- [~] Required vs optional documents listed (SOW, release, house rules)
- [~] UI requires acceptance of all mandatory docs before submit
- [ ] Link-out or preview of document text

### 3.4 Booking flow UX

- [~] Stepper: Package → Schedule → Review
- [~] Back/Continue controls between steps
- [ ] Inline error states for missing selection (no package / no slot)

### 3.5 Tests

- [x] Booking domain tests in `tests/booking` (refunds, deposits, etc.)
- [~] Frontend tests for booking store + data source
- [ ] E2E smoke: pick package, select slot, submit (stubbed payment)

---

## 4. Signup / Auth (stubbed for now)

This vertical depends on auth work that is mostly backend + policy driven.
We track it here so we don’t forget the end-to-end shape.

### 4.1 Core flows

- [ ] Email + password signup
- [ ] Social login (if in scope)
- [ ] Email verification
- [ ] Password reset

### 4.2 Risk & safety

- [ ] Rate limiting, captcha, and risk scoring tied into login
- [ ] Trust tier / verification surfaced on profile & booking

### 4.3 Tests

- [ ] Unit + integration tests for auth flows
- [ ] Abuse/risk tests for brute-force and credential stuffing

---

## 5. Payments (customer-facing)

Note: a lot of booking/finance logic exists in the backend tests, but the
customer-facing payment UI is still to be wired.

### 5.1 Payment methods

- [ ] Stripe (test mode) wired for card payments
- [ ] Display of last 4 digits / brand on confirmation
- [ ] Error handling (card declined, 3DS failures)

### 5.2 Post-payment UX

- [ ] Booking confirmation screen
- [ ] Email confirmation (if in scope)
- [ ] Link to view booking details

### 5.3 Refunds & cancellations (customer view)

- [ ] Cancellation policy surfaced clearly before payment
- [ ] Refund outcomes reflected in UI (full/partial/no refund)

### 5.4 Tests

- [~] Backend booking/finance tests (already present)
- [ ] Payment integration tests (Stripe test mode)
- [ ] E2E smoke: book + pay + see confirmation

---

## 6. Observability & telemetry

- [ ] Search → profile → booking funnel metrics defined
- [ ] Basic event logging for all CTAs (book, message, signup, pay)
- [ ] Metrics/telemetry plan documented for this vertical
