-- WBS-003 Authentication & Authorization Schema

begin;

create schema if not exists auth;

create type auth.session_status as enum ('active', 'revoked', 'expired');
create type auth.device_trust_level as enum ('unknown', 'trusted', 'revoked');
create type auth.mfa_factor_type as enum ('sms_otp', 'totp', 'webauthn');
create type auth.mfa_factor_status as enum ('pending', 'active', 'revoked');
create type auth.login_outcome as enum ('success', 'failure', 'locked');

create table if not exists auth.session (
  session_id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references core.user_account(user_id) on delete cascade,
  device_id uuid not null,
  refresh_hash text not null,
  refresh_salt text not null,
  refresh_pepper_id text,
  status auth.session_status not null default 'active',
  issued_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  user_agent text,
  ip_address text,
  trusted_device boolean not null default false,
  risk_score numeric(5, 3) not null default 0,
  revoked_at timestamptz,
  revoked_reason text,
  constraint chk_auth_session_expiry check (expires_at > issued_at),
  constraint chk_auth_session_idle check (idle_expires_at >= issued_at)
);

create index if not exists idx_auth_session_user on auth.session(user_id);
create index if not exists idx_auth_session_device on auth.session(device_id);
create index if not exists idx_auth_session_status on auth.session(status);
create index if not exists idx_auth_session_active_expiry on auth.session(expires_at) where status = 'active';
create index if not exists idx_auth_session_idle_expiry on auth.session(idle_expires_at) where status = 'active';

create table if not exists auth.session_event (
  event_id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references auth.session(session_id) on delete cascade,
  user_id uuid not null references core.user_account(user_id) on delete cascade,
  event_type text not null,
  recorded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_auth_session_event_session on auth.session_event(session_id);
create index if not exists idx_auth_session_event_user on auth.session_event(user_id);

create table if not exists auth.device_trust (
  device_id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references core.user_account(user_id) on delete cascade,
  fingerprint_hash text not null unique,
  trust_level auth.device_trust_level not null default 'unknown',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_ip text,
  last_user_agent text
);

create index if not exists idx_auth_device_trust_user on auth.device_trust(user_id);

create table if not exists auth.mfa_factor (
  factor_id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references core.user_account(user_id) on delete cascade,
  type auth.mfa_factor_type not null,
  status auth.mfa_factor_status not null default 'pending',
  phone_e164 text,
  secret text,
  backup_codes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  last_verified_at timestamptz
);

create unique index if not exists idx_auth_mfa_factor_user_type
  on auth.mfa_factor(user_id, type)
  where status <> 'revoked';

create table if not exists auth.mfa_challenge (
  challenge_id uuid primary key default uuid_generate_v4(),
  factor_id uuid not null references auth.mfa_factor(factor_id) on delete cascade,
  user_id uuid not null references core.user_account(user_id) on delete cascade,
  session_id uuid references auth.session(session_id) on delete set null,
  type auth.mfa_factor_type not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  code_hash text not null,
  code_salt text not null
);

create index if not exists idx_auth_mfa_challenge_factor on auth.mfa_challenge(factor_id);
create index if not exists idx_auth_mfa_challenge_active on auth.mfa_challenge(expires_at) where attempts < max_attempts;

create table if not exists auth.login_attempt (
  attempt_id uuid primary key default uuid_generate_v4(),
  user_id uuid references core.user_account(user_id) on delete cascade,
  email_sha256 text,
  ip_address text,
  user_agent text,
  occurred_at timestamptz not null default now(),
  outcome auth.login_outcome not null,
  failure_reason text,
  risk_signal jsonb not null default '{}'::jsonb
);

create index if not exists idx_auth_login_attempt_user on auth.login_attempt(user_id);
create index if not exists idx_auth_login_attempt_email_hash on auth.login_attempt(email_sha256);
create index if not exists idx_auth_login_attempt_timestamp on auth.login_attempt(occurred_at desc);

create table if not exists auth.admin_elevation (
  elevation_id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references core.user_account(user_id) on delete cascade,
  session_id uuid not null references auth.session(session_id) on delete cascade,
  factor_id uuid not null references auth.mfa_factor(factor_id) on delete restrict,
  scope jsonb not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint chk_auth_admin_elevation_expiry check (expires_at > granted_at)
);

create index if not exists idx_auth_admin_elevation_user on auth.admin_elevation(user_id);
create index if not exists idx_auth_admin_elevation_session on auth.admin_elevation(session_id);
create index if not exists idx_auth_admin_elevation_active on auth.admin_elevation(expires_at) where revoked_at is null;

commit;
