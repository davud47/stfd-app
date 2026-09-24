-- Ausführen im Supabase SQL-Editor (Dashboard -> SQL Editor -> New query)

-- Profil-Tabelle: eine Zeile pro Konto, unabhängig vom Kauf
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  module2_unlocked boolean not null default false,
  unlocked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Row Level Security aktivieren: jede Person sieht/ändert nur ihre eigene Zeile
alter table public.profiles enable row level security;

create policy "Eigenes Profil lesen"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Eigenes Profil anlegen"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Automatisch ein Profil anlegen, sobald sich jemand registriert
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Wichtig: module2_unlocked darf NICHT von Nutzer:innen selbst änderbar sein,
-- nur vom Server (Edge Function mit Service-Role-Key) nach echtem Kauf.
-- Es gibt bewusst KEINE "update"-Policy für normale Nutzer:innen.
