-- WBS-005 Booking, Checkout, and Payment Processing Core Schema

begin;

create schema if not exists booking;

create type booking.lbg_status as enum (
  'draft',
  'awaiting_docs',
  'awaiting_payment',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'failed'
);

create type booking.leg_status as enum (
  'draft',
  'awaiting_docs',
  'awaiting_payment',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'failed'
);

create type booking.leg_type as enum ('talent', 'studio');

create type booking.charge_status as enum (
  'requires_action',
  'authorized',
  'captured',
  'succeeded',
  'canceled',
  'failed'
);

create type booking.payment_method as enum ('card', 'ach_debit');

create type booking.deposit_status as enum (
  'requires_action',
  'authorized',
  'captured',
  'voided',
  'expired'
);

create type booking.deposit_claim_status as enum (
  'pending',
  'approved',
  'denied',
  'captured',
  'voided'
);

create type booking.amendment_kind as enum (
  'change_order',
  'overtime',
  'refund_line',
  'admin_adjustment'
);

create type booking.refund_status as enum ('pending', 'succeeded', 'failed');

create type booking.dispute_status as enum (
  'needs_response',
  'under_review',
  'won',
  'lost',
  'warning_closed'
);

create type booking.payout_status as enum (
  'queued',
  'in_transit',
  'paid',
  'failed',
  'canceled',
  'paused'
);

create type booking.tax_provider as enum ('taxjar', 'avalara', 'stripe_tax');

create type booking.receipt_kind as enum ('leg', 'group', 'refund');

create or replace function booking.touch_version()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.version = coalesce(old.version, 0) + 1;
  return new;
end;
$$;

create table if not exists booking.lbg (
  lbg_id text primary key,
  buyer_user_id text not null,
  status booking.lbg_status not null default 'draft',
  city text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  acceptance_until timestamptz,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0,
  constraint lbg_time_window check (end_at > start_at)
);

create table if not exists booking.booking_leg (
  leg_id text primary key,
  lbg_id text not null references booking.lbg(lbg_id) on delete cascade,
  type booking.leg_type not null,
  seller_user_id text not null,
  service_profile_id text,
  studio_id text,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  fees_cents integer not null default 0 check (fees_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'USD',
  policy_json jsonb not null default '{}'::jsonb,
  doc_pack_id text,
  status booking.leg_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0,
  constraint booking_leg_amounts check (subtotal_cents + tax_cents + fees_cents = total_cents),
  constraint booking_leg_time_window check (end_at > start_at),
  constraint booking_leg_profile_or_studio check (
    (type = 'talent' and service_profile_id is not null and studio_id is null)
    or (type = 'studio' and studio_id is not null)
  )
);

create index if not exists idx_booking_leg_seller_time on booking.booking_leg (seller_user_id, start_at);
create index if not exists idx_booking_leg_service_profile on booking.booking_leg (service_profile_id) where service_profile_id is not null;
create index if not exists idx_booking_leg_studio on booking.booking_leg (studio_id) where studio_id is not null;
create index if not exists idx_booking_leg_active on booking.booking_leg (status) where status in ('confirmed', 'in_progress');

create table if not exists booking.charge (
  charge_id text primary key,
  lbg_id text not null references booking.lbg(lbg_id) on delete cascade,
  processor text not null,
  processor_intent text not null,
  status booking.charge_status not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD',
  payment_method booking.payment_method,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0,
  unique (processor, processor_intent)
);

create table if not exists booking.charge_split (
  charge_id text not null references booking.charge(charge_id) on delete cascade,
  leg_id text not null references booking.booking_leg(leg_id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  primary key (charge_id, leg_id)
);

create index if not exists idx_charge_split_leg on booking.charge_split (leg_id);

create table if not exists booking.deposit_auth (
  deposit_id text primary key,
  leg_id text not null references booking.booking_leg(leg_id) on delete cascade,
  processor text not null,
  processor_setup text not null,
  status booking.deposit_status not null,
  authorized_cents integer not null check (authorized_cents >= 0),
  captured_cents integer not null default 0 check (captured_cents >= 0),
  currency text not null default 'USD',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0,
  unique (processor, processor_setup)
);

create table if not exists booking.deposit_claim (
  claim_id text primary key,
  deposit_id text not null references booking.deposit_auth(deposit_id) on delete cascade,
  leg_id text not null references booking.booking_leg(leg_id) on delete cascade,
  status booking.deposit_claim_status not null default 'pending',
  amount_cents integer not null check (amount_cents >= 0),
  captured_cents integer not null default 0 check (captured_cents >= 0),
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  submitted_by text not null,
  approved_by text,
  decision_reason text,
  decided_at timestamptz,
  claim_window_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0,
  constraint deposit_claim_capture_bounds check (captured_cents <= amount_cents)
);

create index if not exists idx_deposit_claim_leg on booking.deposit_claim (leg_id);
create index if not exists idx_deposit_claim_status on booking.deposit_claim (status);
create index if not exists idx_deposit_claim_deposit on booking.deposit_claim (deposit_id);

create table if not exists booking.amendment (
  amendment_id text primary key,
  leg_id text not null references booking.booking_leg(leg_id) on delete cascade,
  kind booking.amendment_kind not null,
  line_json jsonb not null,
  delta_subtotal_cents integer not null,
  delta_tax_cents integer not null,
  delta_fees_cents integer not null,
  delta_total_cents integer not null,
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint amendment_line_json_object check (jsonb_typeof(line_json) = 'object'),
  constraint amendment_total_consistency check (
    delta_subtotal_cents + delta_tax_cents + delta_fees_cents = delta_total_cents
  )
);

create table if not exists booking.payout (
  payout_id text primary key,
  leg_id text not null references booking.booking_leg(leg_id) on delete cascade,
  processor text not null,
  processor_payout text,
  status booking.payout_status not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD',
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0
);

create index if not exists idx_payout_leg on booking.payout (leg_id);
create index if not exists idx_payout_status on booking.payout (status);

create table if not exists booking.tax_txn (
  tax_txn_id text primary key,
  leg_id text not null references booking.booking_leg(leg_id) on delete cascade,
  provider booking.tax_provider not null,
  provider_id text not null,
  jurisdiction_json jsonb not null,
  quote_cents integer not null check (quote_cents >= 0),
  committed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0
);

create table if not exists booking.refund (
  refund_id text primary key,
  lbg_id text not null references booking.lbg(lbg_id) on delete cascade,
  leg_id text not null references booking.booking_leg(leg_id) on delete cascade,
  processor text not null,
  processor_refund text,
  amount_cents integer not null check (amount_cents >= 0),
  reason text not null,
  status booking.refund_status not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_refund_leg on booking.refund (leg_id);
create index if not exists idx_refund_status on booking.refund (status);

create table if not exists booking.dispute (
  dispute_id text primary key,
  leg_id text not null references booking.booking_leg(leg_id) on delete cascade,
  processor text not null,
  processor_dispute text not null,
  reason text not null,
  status booking.dispute_status not null,
  evidence_due_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_dispute_leg on booking.dispute (leg_id);
create index if not exists idx_dispute_status on booking.dispute (status);

create table if not exists booking.receipt_manifest (
  receipt_id text primary key,
  lbg_id text not null references booking.lbg(lbg_id) on delete cascade,
  leg_id text references booking.booking_leg(leg_id) on delete set null,
  kind booking.receipt_kind not null,
  doc_hashes jsonb not null default '[]'::jsonb,
  payload jsonb not null,
  storage_url text,
  rendered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0
);

create index if not exists idx_receipt_manifest_kind on booking.receipt_manifest (kind);
create index if not exists idx_receipt_manifest_leg on booking.receipt_manifest (leg_id);

create table if not exists booking.webhook_event (
  provider text not null,
  event_id text not null,
  event_type text not null,
  lbg_id text,
  leg_id text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null,
  primary key (provider, event_id)
);

create index if not exists idx_webhook_event_type on booking.webhook_event (event_type);
create index if not exists idx_webhook_event_received_at on booking.webhook_event (received_at);

drop trigger if exists trg_booking_lbg_touch on booking.lbg;
create trigger trg_booking_lbg_touch
before update on booking.lbg
for each row
execute function booking.touch_version();

drop trigger if exists trg_booking_leg_touch on booking.booking_leg;
create trigger trg_booking_leg_touch
before update on booking.booking_leg
for each row
execute function booking.touch_version();

drop trigger if exists trg_booking_charge_touch on booking.charge;
create trigger trg_booking_charge_touch
before update on booking.charge
for each row
execute function booking.touch_version();

drop trigger if exists trg_booking_deposit_touch on booking.deposit_auth;
create trigger trg_booking_deposit_touch
before update on booking.deposit_auth
for each row
execute function booking.touch_version();

drop trigger if exists trg_booking_deposit_claim_touch on booking.deposit_claim;
create trigger trg_booking_deposit_claim_touch
before update on booking.deposit_claim
for each row
execute function booking.touch_version();

drop trigger if exists trg_booking_payout_touch on booking.payout;
create trigger trg_booking_payout_touch
before update on booking.payout
for each row
execute function booking.touch_version();

drop trigger if exists trg_booking_tax_txn_touch on booking.tax_txn;
create trigger trg_booking_tax_txn_touch
before update on booking.tax_txn
for each row
execute function booking.touch_version();

drop trigger if exists trg_booking_receipt_manifest_touch on booking.receipt_manifest;
create trigger trg_booking_receipt_manifest_touch
before update on booking.receipt_manifest
for each row
execute function booking.touch_version();

comment on table booking.lbg is 'Linked Booking Group container (atomic booking across talent/studio legs).';
comment on table booking.booking_leg is 'Individual booking leg with independent policy, taxes, and payouts.';
comment on table booking.charge is 'LBG-level charge capturing buyer funds.';
comment on table booking.charge_split is 'Allocations of an LBG charge to each leg.';
comment on table booking.deposit_auth is 'Studio deposit authorizations via SetupIntent.';
comment on table booking.deposit_claim is 'Studio deposit claim ledger with approval and capture metadata.';
comment on table booking.amendment is 'Change orders, overtime, refunds, and admin adjustments per leg.';
comment on table booking.payout is 'Stripe Connect payouts for legs, including reserves and scheduling metadata.';
comment on table booking.tax_txn is 'Tax provider transactions per leg.';
comment on table booking.refund is 'Refund executions per leg with Stripe references.';
comment on table booking.dispute is 'Stripe dispute records with evidence windows and outcomes.';
comment on table booking.receipt_manifest is 'Immutable receipt payloads (leg, group, refund) with document hashes and storage references.';
comment on table booking.webhook_event is 'External webhook events captured for idempotent processing and audit.';

commit;
