-- =========================================================
-- SOBIOSE — Agenda des disponibilités (mise à jour d'un projet existant)
-- À exécuter UNE fois dans : Dashboard Supabase > SQL Editor > New query.
-- Peut être relancé sans risque (les règles sont recréées à l'identique).
--
-- Effet : la page de réservation ne propose plus que les créneaux ouverts
-- par la cliente depuis admin.html (section « Mes disponibilités »).
-- =========================================================
create table if not exists disponibilites (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  date_seance   date not null,
  heure_seance  text not null check (heure_seance ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),  -- format 'HH:MM'
  unique (date_seance, heure_seance)
);

drop policy if exists "public_select_disponibilites" on disponibilites;
drop policy if exists "admin_select_disponibilites" on disponibilites;
drop policy if exists "admin_insert_disponibilites" on disponibilites;
drop policy if exists "admin_delete_disponibilites" on disponibilites;

alter table disponibilites enable row level security;

-- Le public ne voit que les créneaux à venir (aucune donnée personnelle ici)
create policy "public_select_disponibilites"
  on disponibilites for select
  to anon
  using (date_seance >= current_date);

-- Seule la cliente connectée ouvre ou retire des créneaux
create policy "admin_select_disponibilites"
  on disponibilites for select
  to authenticated
  using (true);

create policy "admin_insert_disponibilites"
  on disponibilites for insert
  to authenticated
  with check (true);

create policy "admin_delete_disponibilites"
  on disponibilites for delete
  to authenticated
  using (true);

grant select on disponibilites to anon;
grant select, insert, delete on disponibilites to authenticated;
