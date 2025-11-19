-- WBS-007 Smart Docs and Legal Document Management Core Schema

begin;

create schema if not exists smart_docs;

create type smart_docs.pack_status as enum (
  'draft',
  'issued',
  'signed',
  'voided',
  'superseded'
);

create type smart_docs.envelope_status as enum (
  'none',
  'sent',
  'completed',
  'voided',
  'expired'
);

create type smart_docs.sign_event_type as enum (
  'envelope_sent',
  'recipient_viewed',
  'recipient_signed',
  'envelope_completed',
  'envelope_declined',
  'envelope_voided',
  'envelope_expired'
);

create or replace function smart_docs.touch_version()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.version = coalesce(old.version, 0) + 1;
  return new;
end;
$$;

create table if not exists smart_docs.clause (
  clause_id text primary key,
  name text not null,
  version integer not null check (version > 0),
  city_gate text[],
  role_gate text[],
  is_active boolean not null default true,
  body_markdown text not null,
  variables_schema jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  retired_at timestamptz,
  approval_state text not null default 'draft',
  approval_metadata jsonb not null default '{}'::jsonb,
  unique (name, version)
);

create index if not exists idx_clause_active on smart_docs.clause (is_active);
create index if not exists idx_clause_city_gate on smart_docs.clause using gin (city_gate);
create index if not exists idx_clause_role_gate on smart_docs.clause using gin (role_gate);

create table if not exists smart_docs.template (
  template_id text primary key,
  name text not null,
  version integer not null check (version > 0),
  city_gate text[],
  role_gate text[],
  clauses jsonb not null,
  layout jsonb not null,
  signer_roles jsonb not null,
  default_variables jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  requires_dual_approval boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  retired_at timestamptz,
  approval_state text not null default 'draft',
  approval_metadata jsonb not null default '{}'::jsonb,
  unique (name, version)
);

create index if not exists idx_template_active on smart_docs.template (is_active);
create index if not exists idx_template_city_gate on smart_docs.template using gin (city_gate);
create index if not exists idx_template_role_gate on smart_docs.template using gin (role_gate);

create table if not exists smart_docs.pack (
  pack_id text primary key,
  leg_id text not null references booking.booking_leg(leg_id) on delete cascade,
  status smart_docs.pack_status not null default 'draft',
  generator_version text not null,
  city text not null,
  doc_manifest jsonb not null default '[]'::jsonb,
  issued_at timestamptz,
  signed_at timestamptz,
  superseded_by text references smart_docs.pack(pack_id) on delete set null,
  legal_hold boolean not null default false,
  worm_retained_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0,
  constraint pack_status_requires_timestamps check (
    (status = 'issued' and issued_at is not null)
    or (status = 'signed' and issued_at is not null and signed_at is not null)
    or (status in ('draft', 'voided', 'superseded'))
  ),
  constraint pack_worm_retention_future check (worm_retained_until >= created_at),
  unique (leg_id, status) deferrable initially deferred
);

create index if not exists idx_pack_leg on smart_docs.pack (leg_id);
create index if not exists idx_pack_status on smart_docs.pack (status);
create index if not exists idx_pack_created_at on smart_docs.pack (created_at);

create table if not exists smart_docs.doc_instance (
  doc_id text primary key,
  pack_id text not null references smart_docs.pack(pack_id) on delete cascade,
  template_id text not null references smart_docs.template(template_id),
  template_version integer not null,
  variables_resolved jsonb not null,
  render_pdf_s3 text,
  render_pdf_sha256_pre text,
  render_pdf_sha256_post text,
  envelope_id text,
  envelope_status smart_docs.envelope_status not null default 'none',
  signer_map jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  worm_retained_until timestamptz not null,
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 0,
  constraint doc_instance_template_version check (template_version > 0),
  constraint doc_instance_worm_retention_future check (
    worm_retained_until >= created_at
  )
);

create index if not exists idx_doc_instance_pack on smart_docs.doc_instance (pack_id);
create index if not exists idx_doc_instance_template on smart_docs.doc_instance (template_id, template_version);
create index if not exists idx_doc_instance_envelope_status on smart_docs.doc_instance (envelope_status);

create table if not exists smart_docs.sign_event (
  sign_event_id text primary key,
  doc_id text not null references smart_docs.doc_instance(doc_id) on delete cascade,
  provider_event_id text,
  event smart_docs.sign_event_type not null,
  actor_role text not null,
  actor_user_id text,
  actor_email text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  signature_valid boolean not null default true,
  created_at timestamptz not null default now(),
  unique (doc_id, provider_event_id) where provider_event_id is not null
);

create index if not exists idx_sign_event_doc on smart_docs.sign_event (doc_id);
create index if not exists idx_sign_event_event on smart_docs.sign_event (event);
create index if not exists idx_sign_event_occurred_at on smart_docs.sign_event (occurred_at);

create table if not exists smart_docs.legal_hold (
  hold_id text primary key,
  doc_id text not null references smart_docs.doc_instance(doc_id) on delete cascade,
  reason text not null,
  actor_admin text not null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (doc_id) where released_at is null
);

create index if not exists idx_legal_hold_doc on smart_docs.legal_hold (doc_id);
create index if not exists idx_legal_hold_released on smart_docs.legal_hold (released_at);

drop trigger if exists trg_smart_docs_pack_touch on smart_docs.pack;
create trigger trg_smart_docs_pack_touch
before update on smart_docs.pack
for each row
execute function smart_docs.touch_version();

drop trigger if exists trg_smart_docs_doc_instance_touch on smart_docs.doc_instance;
create trigger trg_smart_docs_doc_instance_touch
before update on smart_docs.doc_instance
for each row
execute function smart_docs.touch_version();

comment on table smart_docs.clause is 'Clause library for Smart Docs with semantic versioning, gates, and approval metadata.';
comment on table smart_docs.template is 'Document templates composed of ordered clauses, signer roles, and layout metadata.';
comment on table smart_docs.pack is 'Per-leg document pack enforcing Docs-Before-Pay with WORM retention and re-issue lineage.';
comment on table smart_docs.doc_instance is 'Rendered document instance with template binding, envelope tracking, and hash evidence.';
comment on table smart_docs.sign_event is 'Immutable signer event log sourced from the e-sign provider webhooks.';
comment on table smart_docs.legal_hold is 'Legal hold records preventing modification or re-issue until released.';

comment on column smart_docs.template.clauses is 'Ordered list of clause references including clause_id and version.';
comment on column smart_docs.template.signer_roles is 'Ordered signer role definitions for envelope assembly.';
comment on column smart_docs.template.default_variables is 'Default variable values applied prior to resolver overrides.';
comment on column smart_docs.pack.doc_manifest is 'Manifest of documents within the pack (doc_id, template, hashes, envelope status).';
comment on column smart_docs.pack.worm_retained_until is 'Timestamp when WORM retention requirement lapses (minimum seven years).';
comment on column smart_docs.doc_instance.render_pdf_sha256_pre is 'SHA-256 hash computed immediately after PDF render, prior to signatures.';
comment on column smart_docs.doc_instance.render_pdf_sha256_post is 'SHA-256 hash computed on provider return of signed PDF.';

commit;
