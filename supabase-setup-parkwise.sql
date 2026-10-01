-- ============================================================
--  Parkwise — Supabase setup (users database)
--  Run ONCE:  Supabase Dashboard → SQL Editor → New query →
--  paste this whole file → Run.  Works on the free tier.
--
--  Creates the parkwise_users table with Row Level Security so
--  the Parkwise website (which only ever holds the PUBLIC anon
--  key) can sign people up and check logins, but nothing else.
--
--  Seeded admin account:  admin / admin123
--  (change the password later by signing up a new admin or
--   editing the row in Table Editor)
-- ============================================================

create table if not exists public.parkwise_users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  password_hash text not null,          -- pbkdf2$iterations$saltHex$hashHex
  role          text not null default 'user',   -- 'user' | 'admin'
  created_at    timestamptz not null default now()
);

alter table public.parkwise_users enable row level security;

-- Anyone (anon) may sign up — but only as a normal user.
drop policy if exists "parkwise public signup" on public.parkwise_users;
create policy "parkwise public signup"
  on public.parkwise_users for insert to anon
  with check (role = 'user');

-- Anyone (anon) may look up a row to check a login
-- (passwords are salted + PBKDF2-hashed, never stored in plain text).
drop policy if exists "parkwise public login lookup" on public.parkwise_users;
create policy "parkwise public login lookup"
  on public.parkwise_users for select to anon
  using (true);

-- No update/delete policies: rows can only be changed from the
-- Supabase Table Editor (or with the service key).

-- Seed the admin account (password: admin123)
insert into public.parkwise_users (username, password_hash, role)
values (
  'admin',
  'pbkdf2$100000$15220f71476621b517b2c7622a915919$f014986d1ecbd1588be57504fcca58f95602ad12058d2906448e13f4f8f8b64c',
  'admin'
)
on conflict (username) do nothing;
