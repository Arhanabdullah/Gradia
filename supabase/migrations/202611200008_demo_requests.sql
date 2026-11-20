-- Demo requests table for landing page "Request a demo" form
create table if not exists public.demo_requests (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null,
  institution     text not null,
  role            text not null,
  message         text default '',
  status          text not null default 'new', -- new, contacted, closed
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Enable RLS
alter table public.demo_requests enable row level security;

-- Only admins can read demo requests
drop policy if exists "admin read demo requests" on public.demo_requests;
create policy "admin read demo requests"
  on public.demo_requests for select to authenticated
  using (is_admin());

-- Only admins can update demo requests
drop policy if exists "admin update demo requests" on public.demo_requests;
create policy "admin update demo requests"
  on public.demo_requests for update to authenticated
  using (is_admin())
  with check (is_admin());

-- Allow anonymous insert (for the public demo form)
drop policy if exists "anon insert demo requests" on public.demo_requests;
create policy "anon insert demo requests"
  on public.demo_requests for insert to anon
  with check (true);

-- Index for faster lookups
create index if not exists demo_requests_email_idx on public.demo_requests(email);
create index if not exists demo_requests_created_at_idx on public.demo_requests(created_at desc);