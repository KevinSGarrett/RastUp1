# ADR-003: Stripe Escrow Payment Flow

**Status:** Accepted  
**Date:** 2025-11-18  
**Deciders:** Engineering, Finance, Legal  
**Related:** WBS-005

## Context

We need a payment system that:
- Holds funds in escrow until service completion
- Supports milestone-based releases
- Handles disputes and refunds
- Complies with PCI DSS
- Minimizes fraud risk
- Provides transparent fee structure

## Decision Drivers

- PCI DSS compliance (minimize scope)
- Escrow capability (hold funds until acceptance)
- Dispute resolution support
- Developer experience
- Fee structure and economics
- Payout flexibility (ACH, instant, etc.)

## Considered Options

### Option 1: Stripe Connect with Separate Charges and Transfers
Standard Stripe Connect flow with separate charge and transfer operations.

**Pros:**
- Full control over fund flow
- Flexible fee structure
- Standard Stripe integration

**Cons:**
- Complex escrow logic (manual hold/release)
- Higher PCI scope (we touch funds)
- More code to maintain

### Option 2: Stripe Connect with Payment Intents and Holds (SELECTED)
Use Payment Intents with `capture_method: manual` for escrow, then capture on acceptance.

**Pros:**
- Built-in authorization hold (7 days)
- Reduced PCI scope (Stripe holds funds)
- Simple API (authorize → capture → transfer)
- Automatic expiration handling
- Dispute support built-in

**Cons:**
- 7-day hold limit (need workarounds for longer bookings)
- Slightly higher fees than direct charges

### Option 3: Third-Party Escrow Service
Use specialized escrow service (Escrow.com, PayPal, etc.)

**Pros:**
- Purpose-built for escrow
- Longer hold periods
- Established trust

**Cons:**
- Additional vendor integration
- Higher fees (3-5%)
- Poor developer experience
- Limited customization

## Decision

We will use **Stripe Connect with Payment Intents** for escrow payments.

### Payment Flow

```
1. Client initiates booking
   → Create PaymentIntent (capture_method: manual)
   → Client confirms payment (card authorized, not charged)

2. Service provider accepts booking
   → Funds held by Stripe (up to 7 days)

3. Service completed
   → Client accepts deliverables
   → Capture PaymentIntent (charge card)
   → Transfer to provider (minus platform fee)

4. Dispute (optional)
   → Client disputes within 48 hours
   → Funds held pending resolution
   → Refund or release based on outcome
```

### Handling Long Bookings (>7 days)

For bookings longer than 7 days:
- Authorize payment at booking
- Capture immediately but hold in platform account
- Release to provider on acceptance
- Use internal ledger to track escrow state

### Fee Structure

- Platform fee: 10% of booking amount
- Stripe processing: 2.9% + $0.30
- Provider receives: 87.1% of booking amount (minus Stripe fee)

### Milestone Payments

For multi-milestone bookings:
- Create separate PaymentIntent per milestone
- Authorize all upfront
- Capture each milestone on acceptance
- Partial refunds for incomplete work

## Consequences

### Positive

- Reduced PCI scope (Stripe handles card data and funds)
- Built-in dispute resolution
- Automatic authorization expiration (no orphaned holds)
- Transparent fee structure
- Good developer experience

### Negative

- 7-day authorization limit requires workaround for long bookings
- Slightly higher fees than direct charges
- Dependent on Stripe's dispute resolution process

### Neutral

- Need to implement internal ledger for escrow tracking
- Webhook handling for payment lifecycle events
- Payout scheduling logic for providers

## Implementation Notes

### Database Schema

```sql
CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES users(id),
  provider_id UUID REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  stripe_payment_intent_id TEXT,
  escrow_state TEXT NOT NULL, -- authorized | captured | released | refunded
  accepted_at TIMESTAMP,
  disputed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id),
  type TEXT NOT NULL, -- authorize | capture | transfer | refund
  amount_cents INTEGER NOT NULL,
  stripe_charge_id TEXT,
  stripe_transfer_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Stripe Webhooks

- `payment_intent.succeeded`: Funds authorized
- `payment_intent.payment_failed`: Authorization failed
- `charge.captured`: Funds captured
- `charge.refunded`: Refund processed
- `transfer.created`: Payout to provider
- `charge.dispute.created`: Dispute opened

### Compliance

- PCI DSS Level 1 (Stripe certified)
- No card data stored in our systems
- All transactions logged in immutable audit trail
- Tax reporting (1099-K) handled by Stripe

## Validation

- Escrow flow tested with test cards
- Dispute scenarios validated in Stripe test mode
- Fee calculations verified against financial model
- Webhook reliability tested with replay tools

## References

- [Stripe Payment Intents](https://stripe.com/docs/payments/payment-intents)
- [Stripe Connect](https://stripe.com/docs/connect)
- Blueprint: WBS-005 (Booking & Payments)
- Security: `docs/security/pci_dss.md`
- Related ADRs: ADR-006 (Transaction Ledger)
