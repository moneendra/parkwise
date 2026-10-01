-- ============================================================
--  Parkwise — Supabase setup (users database)
--  Run ONCE:  Supabase Dashboard → SQL Editor → New query →
--  paste this whole file → Run.  Works on the free tier.
--
--  Creates the parkwise_users table with Row Level Security so
--  the Parkwise website (which only ever holds the PUBLIC anon
--  key) can sign people up and check logins, but nothing else.
--
--  Seeded admin account:  moneendra / Moni@2009
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

-- If the old demo admin (admin/admin123) was seeded before, remove it
delete from public.parkwise_users where username = 'admin' and role = 'admin';

-- Seed the admin account (password: Moni@2009)
insert into public.parkwise_users (username, password_hash, role)
values (
  'moneendra',
  'pbkdf2$100000$8654b38de8bab6ee91f5507606a74935$5499b2f42622a705ca9bfbffd2668b891b28b44622b9105bb1bfd612a9ed48a5',
  'admin'
)
on conflict (username) do update set password_hash = excluded.password_hash, role = 'admin';
