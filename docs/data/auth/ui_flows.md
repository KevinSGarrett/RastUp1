# UX & Flow Specification — WBS-004

## Authentication Journeys

### 1. Email / Password Signup

1. **Step 0 — Locale Prefill**
   - Detect locale from path (`/[locale]/auth/signup`), surface hreflang and currency hints.
   - If invite code present, preload account type and email.
2. **Step 1 — Credentials**
   - Inputs: email, password, optional referral code.
   - Inline validation with `password_policy.calculatePasswordScore`.
   - Run async breach check after debounce; show warnings and block submission for high-risk hits.
3. **Step 2 — Email Verification**
   - One-time code or magic link; enforce expiry (15 min) and retry limit.
   - Show progress meter; allow resend with cooldown & CAPTCHA on velocity detection.
4. **Step 3 — Account Typing**
   - Choose provider vs host vs both. This seeds onboarding wizard branch.
5. **Step 4 — MFA Opt-in**
   - Offer SMS authenticator setup; auto-suggest if risk score high.
6. **Completion**
   - Redirect into onboarding wizard (provider identity step or studio basics).

### 2. Email Login with Risk Controls

1. Email entry; fetch risk signals (device fingerprint, IP history).
2. Password submission:
   - Evaluate via `lockout_policy.registerAttempt`.
   - If threshold reached, surface CAPTCHA modal (friendly fallback).
3. On success:
   - Issue httpOnly cookie via backend (AppSync session mutation).
   - Device recognition banner if new device.
4. On failure:
   - Persist attempt; show contextual message summarizing wait period or CAPTCHA requirement.
   - After 5 failures: lock account for 15 min; offer password reset.

### 3. Social Login (Apple / Google)

1. Launch provider flow (PKCE).
2. Handle redirect + token exchange via backend (serverless).
3. If user profile incomplete:
   - Land in Step 3 of signup (account typing) with federated identity prebound.
4. Apple private relay email support: prompt to add recovery email later.

### 4. Optional SMS Login (Passwordless fallback)

1. Request phone number (E.164) → send OTP.
2. Accept OTP (6 digits, 5 min expiry).
3. If new device, require existing auth factor challenge.

### 5. Password Reset

1. Request email → send OTP / link with 15 min expiry.
2. Validate OTP (with CAPTCHA gating on velocity).
3. Prompt for new password; reuse password policy validation + breach check.
4. Session revocation post reset; sign in automatically if risk < threshold.

## MFA & Step-Up Actions

- Sensitive actions: payout destination edits, email change, viewing DSAR exports.
- Flow:
  1. Trigger `mfa_policy.shouldStepUp(action, riskContext)` from UI.
  2. If required, present factor chooser (SMS, TOTP, backup codes).
  3. Collect challenge, call backend; on success continue action; on failure log and optionally escalate to support.
- Device trust:
  - Allow 30-day "remember" scoped to factor & device with signed cookie; still re-prompt if risk delta high.

## Onboarding Wizards

### Wizard Shell

- Layout: vertical steps with autosave footer (`Save & exit`) and progress meter.
- Autosave triggers on field blur and step transition.
- Offline storage via IndexedDB queue (deferred until PWA scaffold).
- Accessibility: announce step changes, keyboard trap prevention.

### Provider Branch

| Step | Title | Requirements | Autosave Payload |
|------|-------|--------------|------------------|
| 1 | Identity & Basics | Legal name, display name, pronouns (optional), location, hero image | `profile.identity` |
| 2 | Roles & Tags | Select roles, specialties, service tags | `profile.roles` |
| 3 | Portfolio Media | Upload/crop images, reorder, select cover | `profile.portfolio` |
| 4 | Packages & Pricing | Define packages, hourly ranges, add-ons | `profile.pricing` |
| 5 | Availability | Weekly schedule, blackout sync toggle | `profile.availability` |
| 6 | Verification | ID upload, tax info stub, consent, optional T&S review | `profile.verification` |
| 7 | Review & Publish | Completeness summary, gating reasons, CTA to request verification | derived |

### Host / Studio Branch

| Step | Title | Requirements | Autosave Payload |
|------|-------|--------------|------------------|
| 1 | Studio Basics | Name, hero carousel, city, capacity, contact preferences | `studio.basics` |
| 2 | Amenities & Policies | Amenity checklist, cancellation & reschedule policies | `studio.policies` |
| 3 | Pricing & Deposits | Hourly pricing bands, deposits, fees | `studio.pricing` |
| 4 | Availability & Buffers | Calendar sync setup, buffers, blackout import | `studio.availability` |
| 5 | Verification | Business documents, insurance proof | `studio.verification` |
| 6 | Publish Preview | Completeness + map pin preview (approx vs exact location) | derived |

## Completeness & Gating Logic

- Score range 0–100.
- Provider gating:
  - Publish ≥ 70 and verification submitted.
  - Instant Book ≥ 85, includes availability + payment setup.
- Studio gating:
  - Publish ≥ 65 with verified address + insurance.
  - Instant Book ≥ 80 plus deposit policy configured.
- `completeness.evaluate(data)` returns:
  - `score`
  - `blocks` (array of reasons)
  - `eligible` flags (`publish`, `instantBook`, `searchBoost`)

## Nudges & Digest Cadence

- In-app banners triggered when:
  - Score < threshold but high value fields missing (e.g., no portfolio).
  - Verification pending for >3 days.
  - Pricing inconsistent between packages and availability.
- Weekly digest (email):
  - Monday 09:00 locale.
  - Includes completion percentage, top 3 actions, latest bookings/reviews summary (if available).
  - CTA includes direct deep links (`/[locale]/dashboard/onboarding?step=`).

## Public Profile View (Read-Only)

- Layout sections:
  1. Hero (image/video, verified badge, role chips, CTA `Book Now` / `Request Booking`).
  2. About & Highlights (bio, tags, languages).
  3. Portfolio carousel (SFW derivatives; NSFW placeholder with lock icon).
  4. Packages & Pricing summary.
  5. Availability preview (next 14 days from search service).
  6. Reviews & Ratings (with gating if <5 reviews).
  7. Policies and FAQs.
  8. Studio map (host branch).

- SEO:
  - JSON-LD inserted via `seo_builder.buildProfileJsonLd`.
  - Canonical `/[locale]/[role]/[slug]`; hreflang for available locales.
  - `Safe-Mode`: Append `?safe=on` to enforce sanitized view; hide flagged content.

## Error & Incident UX

- **Account lockout**: Inline error with countdown timer; CTA to reset password or contact support.
- **Moderation hold**: Banner on profile dashboard showing flagged assets, link to moderation guidelines.
- **Verification failure**: Step-level error summary; highlight fields needing re-upload, include doc tips.
- **CAPTCHA**: Use turnstile/friendly copy; supports keyboard and screen readers; fallback audio challenge.

## Accessibility Notes

- All interactive elements reachable via keyboard in natural order.
- Provide focus traps only during modal flows (CAPTCHA, MFA challenge).
- ARIA live regions for async validations (breach check, autosave success/failure).
- Color contrast verified; progress meter uses text + icons to convey status.

---

_Prepared by AGENT-3 on 2025-11-18._
