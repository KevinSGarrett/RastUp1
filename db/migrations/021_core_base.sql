-- WBS-002 Core Backend Schema (accounts, profiles, trust, analytics)

begin;

create extension if not exists "uuid-ossp";
create extension if not exists "citext";

create type if not exists user_status as enum ('pending','active','suspended','closed');
create type if not exists service_profile_status as enum ('draft','pending_review','published','suspended');
create type if not exists booking_status as enum ('draft','pending','confirmed','in_session','completed','cancelled');
create type if not exists booking_leg_status as enum ('draft','pending','confirmed','in_session','completed','cancelled');
create type if not exists payment_status as enum (
  'requires_payment_method',
  'requires_confirmation',
  'authorized',
  'captured',
  'refunded',
  'failed',
  'cancelled'
);
create type if not exists privacy_tier as enum ('public','tier1','tier2','restricted');
create type if not exists pii_mask_strategy as enum ('none','hash','tokenize','redact');

create table if not exists app_user (
  user_id uuid primary key default uuid_generate_v4(),
  external_id text unique,
  email citext not null unique,
  phone_e164 text,
  password_hash text not null,
  password_salt text not null,
  display_name text not null,
  status user_status not null default 'pending',
  roles text[] not null check (array_length(roles, 1) between 1 and 6),
  locale text not null default 'en_US',
  country text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consent_json jsonb not null default '{}'::jsonb,
  marketing_opt_in boolean not null default false,
  pii_retention_class text not null default 'standard'
);

create index if not exists idx_app_user_status on app_user(status);
create index if not exists idx_app_user_country on app_user(country);

create table if not exists user_profile_document (
  doc_id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references app_user(user_id) on delete cascade,
  doc_type text not null,
  storage_uri text not null,
  checksum_sha256 text not null,
  uploaded_at timestamptz not null default now(),
  verified boolean not null default false,
  verified_by uuid references app_user(user_id),
  verified_at timestamptz
);

create index if not exists idx_user_profile_document_user on user_profile_document(user_id);

create table if not exists service_profile (
  service_profile_id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references app_user(user_id) on delete cascade,
  role text not null check (role in ('model','photographer','videographer','creator','fansub')),
  display_name text not null,
  slug text not null unique,
  status service_profile_status not null default 'draft',
  city text not null,
  region text,
  country text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  about_fields jsonb not null check (jsonb_typeof(about_fields) = 'object'),
  pricing_fields jsonb not null check (jsonb_typeof(pricing_fields) = 'array'),
  social_fields jsonb,
  languages text[] not null default '{}'::text[] check (cardinality(languages) <= 5),
  tags text[] not null default '{}'::text[] check (cardinality(tags) <= 12),
  safe_mode_band smallint not null default 0 check (safe_mode_band between 0 and 2),
  completeness_score smallint not null default 0 check (completeness_score between 0 and 100),
  instant_book boolean not null default false,
  verification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (user_id, role)
);

create index if not exists idx_service_profile_status_role on service_profile(status, role);
create index if not exists idx_service_profile_location on service_profile(country, city);

create table if not exists studio (
  studio_id uuid primary key default uuid_generate_v4(),
  owner_user_id uuid not null references app_user(user_id) on delete cascade,
  name text not null,
  slug text not null unique,
  description text,
  city text not null,
  region text,
  country text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  address_line1 text,
  address_line2 text,
  postal_code text,
  amenities jsonb not null default '[]'::jsonb check (jsonb_typeof(amenities) = 'array'),
  deposit_required boolean not null default false,
  verified boolean not null default false,
  nsfw_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_studio_owner on studio(owner_user_id);

create table if not exists studio_service_profile (
  studio_id uuid not null references studio(studio_id) on delete cascade,
  service_profile_id uuid not null references service_profile(service_profile_id) on delete cascade,
  role_attribution text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (studio_id, service_profile_id)
);

create table if not exists booking (
  booking_id uuid primary key default uuid_generate_v4(),
  buyer_user_id uuid not null references app_user(user_id) on delete restrict,
  buyer_account_id uuid,
  currency char(3) not null,
  status booking_status not null default 'draft',
  buyer_timezone text not null,
  quote_subtotal_cents integer not null default 0,
  quote_tax_cents integer not null default 0,
  quote_fees_cents integer not null default 0,
  quote_total_cents integer not null default 0,
  deposit_required boolean not null default false,
  instant_book boolean not null default false,
  docs_before_pay boolean not null default true,
  cancellation_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_booking_buyer on booking(buyer_user_id);
create index if not exists idx_booking_status on booking(status);

create table if not exists booking_leg (
  leg_id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references booking(booking_id) on delete cascade,
  service_profile_id uuid not null references service_profile(service_profile_id) on delete restrict,
  studio_id uuid references studio(studio_id) on delete set null,
  seller_user_id uuid not null references app_user(user_id) on delete restrict,
  status booking_leg_status not null default 'draft',
  session_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  buffer_min integer not null default 60 check (buffer_min between 0 and 240),
  subtotal_cents integer not null,
  tax_cents integer not null default 0,
  fees_cents integer not null default 0,
  total_cents integer not null,
  payout_cents integer not null,
  currency char(3) not null,
  policy_snapshot jsonb not null,
  availability_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_leg_time check (end_at > start_at),
  constraint booking_leg_total check (subtotal_cents + tax_cents + fees_cents = total_cents),
  unique (booking_id, service_profile_id)
);

create index if not exists idx_booking_leg_service_profile on booking_leg(service_profile_id);
create index if not exists idx_booking_leg_status on booking_leg(status);

create table if not exists booking_leg_addon (
  addon_id uuid primary key default uuid_generate_v4(),
  leg_id uuid not null references booking_leg(leg_id) on delete cascade,
  name text not null,
  quantity integer not null default 1 check (quantity >= 1),
  unit_price_cents integer not null check (unit_price_cents >= 100),
  subtotal_cents integer not null
);

create table if not exists booking_leg_history (
  history_id bigserial primary key,
  leg_id uuid not null references booking_leg(leg_id) on delete cascade,
  previous_status booking_leg_status not null,
  next_status booking_leg_status not null,
  changed_by uuid not null references app_user(user_id),
  changed_at timestamptz not null default now(),
  reason text,
  context jsonb not null default '{}'::jsonb
);

create table if not exists payment_intent (
  payment_intent_id uuid primary key default uuid_generate_v4(),
  leg_id uuid not null references booking_leg(leg_id) on delete cascade,
  provider text not null,
  provider_payment_intent_id text not null,
  status payment_status not null,
  amount_cents integer not null,
  currency char(3) not null,
  capture_method text not null,
  receipt_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_intent_id)
);

create table if not exists payment_transaction (
  payment_id uuid primary key default uuid_generate_v4(),
  payment_intent_id uuid not null references payment_intent(payment_intent_id) on delete cascade,
  kind text not null check (kind in ('authorization','capture','refund','payout')),
  status payment_status not null,
  amount_cents integer not null,
  fee_cents integer not null default 0,
  currency char(3) not null,
  processed_at timestamptz not null default now(),
  external_id text,
  response jsonb not null default '{}'::jsonb
);

create index if not exists idx_payment_transaction_intent on payment_transaction(payment_intent_id);

create table if not exists message_thread (
  thread_id uuid primary key default uuid_generate_v4(),
  booking_id uuid references booking(booking_id) on delete set null,
  created_at timestamptz not null default now(),
  subject text,
  last_message_at timestamptz
);

create table if not exists message_participant (
  thread_id uuid not null references message_thread(thread_id) on delete cascade,
  user_id uuid not null references app_user(user_id) on delete cascade,
  role text not null check (role in ('buyer','seller','support','system')),
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table if not exists message (
  message_id uuid primary key default uuid_generate_v4(),
  thread_id uuid not null references message_thread(thread_id) on delete cascade,
  sender_id uuid references app_user(user_id) on delete set null,
  body text not null,
  body_rendered text,
  attachments jsonb not null default '[]'::jsonb,
  visibility text not null default 'everyone' check (visibility in ('everyone','internal','system')),
  safe_mode_band smallint not null default 0 check (safe_mode_band between 0 and 2),
  created_at timestamptz not null default now(),
  redacted boolean not null default false
);

create index if not exists idx_message_thread_created_at on message(thread_id, created_at);

create table if not exists review (
  review_id uuid primary key default uuid_generate_v4(),
  service_profile_id uuid not null references service_profile(service_profile_id) on delete cascade,
  booking_id uuid references booking(booking_id) on delete set null,
  author_user_id uuid not null references app_user(user_id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  title text,
  body text,
  tags text[] not null default '{}'::text[],
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_review_service_profile on review(service_profile_id);
create index if not exists idx_review_author on review(author_user_id);

create table if not exists promotion (
  promotion_id uuid primary key default uuid_generate_v4(),
  owner_user_id uuid not null references app_user(user_id) on delete cascade,
  scope text not null check (scope in ('platform','city','role','profile')),
  scope_ref uuid,
  kind text not null check (kind in ('discount','boost','bundle','referral')),
  status text not null check (status in ('draft','scheduled','active','ended','cancelled')),
  budget_cents integer not null default 0,
  spend_cents integer not null default 0,
  start_at timestamptz,
  end_at timestamptz,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_promotion_scope on promotion(scope, scope_ref);

create table if not exists trust_case (
  trust_case_id uuid primary key default uuid_generate_v4(),
  source text not null check (source in ('user_report','auto_detect','support_escalation')),
  reported_by uuid references app_user(user_id),
  subject_user_id uuid references app_user(user_id),
  booking_id uuid references booking(booking_id),
  severity text not null check (severity in ('low','medium','high','critical')),
  status text not null check (status in ('open','triage','investigating','resolved','closed')),
  category text not null,
  summary text not null,
  details text,
  attachments jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists idx_trust_case_status on trust_case(status);
create index if not exists idx_trust_case_subject on trust_case(subject_user_id);

create table if not exists idv_status (
  idv_id text primary key,
  user_id uuid not null references app_user(user_id) on delete cascade,
  provider text not null,
  provider_ref text not null,
  status text not null check (status in ('pending','passed','failed','expired','requires_review')),
  checks_json jsonb not null,
  age_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_ref)
);

create table if not exists bg_status (
  bg_id text primary key,
  user_id uuid not null references app_user(user_id) on delete cascade,
  provider text not null,
  provider_ref text not null,
  status text not null check (status in ('invited','in_progress','clear','consider','suspended','disputed','withdrawn','expired')),
  package text not null,
  adjudication text,
  report_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_ref)
);

create table if not exists social_verification (
  soc_id text primary key,
  user_id uuid not null references app_user(user_id) on delete cascade,
  platform text not null check (platform in ('instagram','tiktok','youtube','x')),
  handle text not null,
  verified boolean not null default false,
  snapshot_json jsonb,
  last_checked_at timestamptz
);

create table if not exists trust_badge (
  badge_id text primary key,
  user_id uuid not null references app_user(user_id) on delete cascade,
  kind text not null check (kind in ('id_verified','trusted_pro','social_verified')),
  source_id text,
  issued_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists trust_risk_signal (
  signal_id text primary key,
  user_id uuid not null references app_user(user_id) on delete cascade,
  window daterange not null,
  disputes_opened integer not null default 0,
  refunds_asked integer not null default 0,
  cancellations integer not null default 0,
  late_delivery integer not null default 0,
  charge_failures integer not null default 0,
  bad_clicks integer not null default 0,
  flags_json jsonb not null default '{}'::jsonb,
  score integer not null default 0,
  computed_at timestamptz not null default now()
);

create index if not exists idx_trust_badge_user_kind on trust_badge(user_id, kind);
create index if not exists idx_trust_risk_signal_user on trust_risk_signal(user_id);

create table if not exists support_ticket (
  ticket_id uuid primary key default uuid_generate_v4(),
  opened_by uuid not null references app_user(user_id) on delete set null,
  assignee uuid references app_user(user_id),
  booking_id uuid references booking(booking_id),
  channel text not null check (channel in ('email','chat','phone','in_app','system')),
  priority text not null check (priority in ('low','normal','high','urgent')),
  status text not null check (status in ('open','pending','waiting_customer','resolved','closed')),
  subject text not null,
  body text,
  category text not null,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists idx_support_ticket_status on support_ticket(status);

create table if not exists analytics_event_bronze (
  bronze_event_id bigserial primary key,
  event_name text not null,
  event_version integer not null check (event_version > 0),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  privacy_tier privacy_tier not null,
  source text not null,
  request_id text,
  schema_hash text not null,
  ingestion_status text not null default 'pending' check (ingestion_status in ('pending','validated','rejected')),
  rejection_reason text,
  pii_mask_strategy pii_mask_strategy not null default 'hash'
);

create index if not exists idx_analytics_event_bronze_state on analytics_event_bronze(ingestion_status);
create index if not exists idx_analytics_event_bronze_privacy on analytics_event_bronze(privacy_tier);

create table if not exists analytics_event_silver (
  silver_event_id bigserial primary key,
  bronze_event_id bigint not null unique references analytics_event_bronze(bronze_event_id) on delete cascade,
  user_id uuid,
  service_profile_id uuid,
  booking_id uuid,
  canonical_event_name text not null,
  canonical_event_version integer not null,
  canonical_payload jsonb not null,
  derived_at timestamptz not null default now(),
  data_quality jsonb not null default '{}'::jsonb,
  pii_fields_masked jsonb not null default '{}'::jsonb
);

create index if not exists idx_analytics_event_silver_canonical on analytics_event_silver(canonical_event_name, canonical_event_version);

create table if not exists analytics_event_gold_daily (
  bucket_date date not null,
  metric_name text not null,
  dimensions jsonb not null default '{}'::jsonb,
  value numeric(20,4) not null,
  source text not null,
  freshness_status text not null default 'pending' check (freshness_status in ('pending','complete','late','failed')),
  updated_at timestamptz not null default now(),
  dimensions_hash int generated always as (hashtext(dimensions::text)) stored,
  primary key (bucket_date, metric_name, dimensions_hash)
);

create table if not exists dsar_request (
  dsar_request_id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references app_user(user_id) on delete cascade,
  request_type text not null check (request_type in ('export','delete','rectify')),
  status text not null check (status in ('pending','in_progress','complete','error')),
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  export_location text,
  notes text,
  handler uuid references app_user(user_id),
  scope jsonb not null default '{}'::jsonb
);

create index if not exists idx_dsar_request_user on dsar_request(user_id);

create table if not exists pii_mask_audit (
  audit_id bigserial primary key,
  user_id uuid references app_user(user_id) on delete set null,
  source_table text not null,
  source_column text not null,
  masking_strategy pii_mask_strategy not null,
  masked_at timestamptz not null default now(),
  actor uuid references app_user(user_id),
  justification text
);

create table if not exists schema_contract_registry (
  contract_id uuid primary key default uuid_generate_v4(),
  event_name text not null,
  version integer not null check (version > 0),
  schema_uri text not null,
  checksum_sha256 text not null,
  privacy_tier privacy_tier not null,
  status text not null check (status in ('draft','approved','deprecated','retired')),
  approved_by uuid references app_user(user_id),
  approved_at timestamptz,
  replaced_by integer,
  created_at timestamptz not null default now(),
  unique (event_name, version)
);

create table if not exists schema_contract_ci_gate (
  gate_id bigserial primary key,
  contract_id uuid not null references schema_contract_registry(contract_id) on delete cascade,
  pipeline_name text not null,
  job_identifier text not null,
  run_id text,
  status text not null check (status in ('pending','passed','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  log_uri text
);

create table if not exists lineage_edge (
  edge_id bigserial primary key,
  source_table text not null,
  source_column text,
  target_table text not null,
  target_column text,
  transformation text,
  last_observed_at timestamptz not null default now(),
  documented_by uuid references app_user(user_id)
);

create index if not exists idx_lineage_edge_source on lineage_edge(source_table);
create index if not exists idx_lineage_edge_target on lineage_edge(target_table);

commit;
