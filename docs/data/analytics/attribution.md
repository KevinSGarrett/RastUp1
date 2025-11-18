# Attribution with Click-Token Proof

Status: Draft v0.1  
Owner: Growth Analytics  
Scope: Define click-token generation, ingestion, storage, and monetisation attribution for WBS-020.

## 1. Goals

- Attribute marketplace conversions (bookings, studio engagements, payouts) to marketing channels with cryptographic click proof.
- Support self-serve channel grouping for campaigns (Paid Search, Paid Social, Organic, Referrals, Partnerships, Influencer).
- Prevent fraud (token replay, tampering) while respecting privacy tiers and opt-outs.

## 2. Click-Token Envelope

```
struct ClickToken {
  version: u8,                    # Bumps on structural changes.
  click_id: uuid,                 # Unique per click event.
  campaign_id: string,            # Growth system campaign identifier.
  channel: string,                # marketing.channel code (e.g., paid_search.google).
  placement: string,              # optional placement / creative ID.
  occurred_at: timestamptz,       # click timestamp.
  anon_id: string,                # hashed browser/device ID (if available).
  signature: string               # base64url(HMAC-SHA256(payload, shared_secret)).
}
```

- Tokens embedded in click redirect URLs (`https://rastup.example/ct?t=<token>`).
- Redirect Lambda verifies signature, stores token, and issues HTTP 302 to landing page with `rastup_id=<click_id>`.

## 3. Ingestion & Storage

1. Redirect Lambda writes token to DynamoDB `click_token_store` with TTL = 30 days.
2. Landing page SDK stores `click_id` in first-party cookie (7 days) and attaches to subsequent events (`checkout.start`, `booking.confirmed`).
3. Server-side events (e.g., Stripe webhooks) attempt to look up `click_id` via `booking.leg_id` → `session_id` mapping; if missing, we rely on last-touch heuristics using `channel_attribution` table.
4. Silver layer computes `fact_attribution_conversions` with fields:
   - `click_id`, `identity_id`, `conversion_event`, `conversion_timestamp`.
   - `attribution_model` (`last_touch`, `first_touch`, `assist`, `proof`).
   - `channel_group` (see §4).
   - `is_valid_proof` (boolean; true only when signature verified and conversion within attribution window).

## 4. Channel Grouping

| Channel Group | Definition |
|---------------|-----------|
| `paid_search` | `channel` starts with `paid_search.` (Google, Bing). |
| `paid_social` | `paid_social.` (Meta, TikTok, Snap). |
| `organic_social` | `organic_social.` or absence of paid token with referrer social domain. |
| `affiliate` | `affiliate.` (partners, marketplace cross-promo). |
| `influencer` | `influencer.` (manual ingestion with proof). |
| `email` | `email.` (HubSpot/Customer.io triggered). |
| `direct` | No referrer and no click proof within attribution window. |

Channel grouping configuration lives in `analytics.channel_groups` table (dbt seed) and is cached in Lambda for 15 minutes.

## 5. Attribution Windows & Models

- **Default window**: 7 days for paid, 1 day for organic/direct. Configurable per campaign.
- **Model support**:
  - `last_touch_proof`: only counts conversion if click proof exists and within window.
  - `first_touch_proof`: earliest verified click wins; fallback to last touch if proof missing.
  - `assist`: any verified click within window flagged as assist.
  - `multi_touch_fractional`: WIP; allocate credit using exponential decay.
- Conversions without proof still recorded with `is_valid_proof = false` to enable comparison.

## 6. Fraud & Integrity Guardrails

- HMAC shared secret rotated quarterly; tokens older than 30 days invalid.
- Replay detection: DynamoDB conditional write rejects duplicate `click_id`.
- Device mismatch: when `anon_id` present, conversion must match stored token `anon_id`; otherwise flagged as `mismatch`.
- Abnormal click volume >3σ above baseline triggers alert and toggles `campaign_status = paused`.
- Privacy respect: tokens store hashed identifiers only; DSAR deletes remove `click_id` associations via job outlined in `runbooks.md`.

## 7. Reporting Surfaces

- `kpi_paid_attributed_gmv_daily`: sums GMV for conversions with valid proof.
- `kpi_nonproof_conversion_rate`: percentage of conversions lacking proof (indicates instrumentation gaps).
- QuickSight dashboards:
  - Growth Overview: channel mix, CAC proxy, proof vs non-proof conversion share.
  - Campaign Pacing: budget burn, forecast vs actual conversions, anomalies.
- Metabase self-serve queries enforce filters to respect channel group row-level security.

## 8. Open Questions

- Should influencer campaigns require manual upload of proof artifacts (screenshots, UTMs)? Proposed: integrate via Partner Portal with signed tokens.
- Evaluate multi-touch fractional methodology — candidate: Shapley value approximation or Markov chain removal effect.
- Determine retention beyond 30 days for high-touch enterprise deals (requires legal review).
