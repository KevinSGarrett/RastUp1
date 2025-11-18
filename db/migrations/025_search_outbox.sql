-- WBS-003 Search & Indexing Outbox
-- Creates the search.outbox table used by the indexing pipeline.

begin;

create schema if not exists search;

create type search.entity_type as enum ('person','studio','work','help');
create type search.operation_type as enum ('upsert','delete');

create table if not exists search.outbox (
  event_id bigserial primary key,
  entity search.entity_type not null,
  entity_id text not null,
  op search.operation_type not null,
  payload jsonb not null,
  source_version bigint not null default 0,
  correlation_id text,
  retry_count smallint not null default 0 check (retry_count between 0 and 10),
  last_error text,
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_search_outbox_processed_created
  on search.outbox (processed, created_at);

create index if not exists idx_search_outbox_entity_entity_id
  on search.outbox (entity, entity_id);

create table if not exists search.outbox_dlq (
  event_id bigint primary key,
  entity search.entity_type not null,
  entity_id text not null,
  op search.operation_type not null,
  payload jsonb not null,
  source_version bigint not null default 0,
  correlation_id text,
  retry_count smallint not null,
  last_error text not null,
  failed_at timestamptz not null default now()
);

comment on table search.outbox is 'Outbox queue for search indexer (Typesense/OpenSearch).';
comment on table search.outbox_dlq is 'Dead letter queue for events that exceeded retry count.';

create or replace function search.touch_outbox_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_search_outbox_touch on search.outbox;
create trigger trg_search_outbox_touch
before update on search.outbox
for each row
execute function search.touch_outbox_updated_at();

commit;
