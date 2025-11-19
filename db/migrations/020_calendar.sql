begin;

create schema if not exists cal;

-- Weekly recurring availability rules
create table cal.weekly_rule (
  rule_id text primary key, -- wr_*
  user_id text not null, -- provider
  role_code text not null, -- model|photographer|...
  weekday_mask int not null, -- bitmask Mon..Sun
  start_local time not null,
  end_local time not null,
  timezone text not null, -- IANA tz
  min_duration_min int not null default 60,
  lead_time_hours int not null default 24,
  booking_window_days int not null default 60,
  buffer_before_min int not null default 0,
  buffer_after_min int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Per-date overrides (vacation day, extended hours, special blocks)
create table cal.exception (
  exc_id text primary key, -- ex_*
  user_id text not null,
  date_local date not null,
  timezone text not null,
  kind text not null check (kind in ('available','unavailable')),
  start_local time,
  end_local time,
  note text,
  created_at timestamptz default now()
);

-- Holds (soft blocks) created by checkout/reschedule/admin
create table cal.hold (
  hold_id text primary key, -- hld_*
  user_id text not null,
  role_code text not null,
  start_utc timestamptz not null,
  end_utc timestamptz not null,
  source text not null check (source in ('checkout','reschedule','admin')),
  order_id text, -- optional linkage
  ttl_expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Confirmed booking instances (authoritative)
create table cal.event (
  event_id text primary key, -- cev_*
  user_id text not null,
  role_code text not null,
  order_id text not null,
  start_utc timestamptz not null,
  end_utc timestamptz not null,
  status text not null check (status in ('confirmed','cancelled')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- External calendar connections
create table cal.external_source (
  src_id text primary key, -- cxs_*
  user_id text not null,
  kind text not null check (kind in ('ics','google','microsoft')),
  url_or_remote_id text not null, -- ICS url or remote calendar id
  status text not null check (status in ('active','paused','error')) default 'active',
  last_poll_at timestamptz,
  last_etag text,
  last_modified text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Flattened external events (busy) for conflict checks
create table cal.external_event (
  ext_event_id text primary key, -- xev_*
  src_id text not null references cal.external_source(src_id) on delete cascade,
  user_id text not null,
  start_utc timestamptz not null,
  end_utc timestamptz not null,
  busy boolean not null default true,
  summary text,
  recurrence_id text, -- normalized id for recurring instances
  updated_at timestamptz default now()
);

-- Per-user outbound ICS feed (tokenized URL)
create table cal.ics_feed (
  feed_id text primary key, -- ifd_*
  user_id text not null,
  token text not null unique, -- long random token
  include_holds boolean not null default false,
  created_at timestamptz default now()
);

commit;
