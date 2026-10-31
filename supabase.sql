-- Jalankan di Supabase: SQL Editor > New query > Run
create table if not exists public.docs (
  col     text  not null,
  id      text  not null,
  data    jsonb not null,
  created timestamptz not null default now(),
  primary key (col, id)
);
create index if not exists docs_col_created on public.docs (col, created);
-- RLS aktif tanpa policy = hanya service_role key (server) yang bisa akses.
alter table public.docs enable row level security;
