-- =========================================================
-- AU FIL DE SOI — Schéma Supabase
-- À exécuter dans : Dashboard Supabase > SQL Editor > New query
-- =========================================================

-- Table principale des réservations
create table if not exists reservations (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  prestation    text not null,
  prix          numeric not null,
  lieu          text not null check (lieu in ('Visio', 'Chez l''organisateur (groupe)')),
  date_seance   date not null,
  heure_seance  text not null,              -- format 'HH:MM', ex '09:00'
  prenom        text not null,
  nom           text not null,
  email         text not null,
  telephone     text not null,
  message       text,
  statut        text not null default 'en_attente'
                check (statut in ('en_attente', 'confirme', 'refuse', 'annule'))
);

-- Empêche deux réservations ACTIVES (en_attente ou confirmé) sur le même
-- créneau : c'est la vraie protection anti-double-réservation, au niveau
-- base de données (pas seulement côté JavaScript).
create unique index if not exists reservations_creneau_actif
  on reservations (date_seance, heure_seance)
  where statut in ('en_attente', 'confirme');

-- Index pour accélérer les requêtes de disponibilité
create index if not exists reservations_date_idx on reservations (date_seance);

-- =========================================================
-- Sécurité (Row Level Security)
-- =========================================================
alter table reservations enable row level security;

-- N'importe quel visiteur du site peut CRÉER une demande de réservation,
-- mais uniquement avec le statut "en_attente" (il ne peut pas s'auto-confirmer).
create policy "public_insert_pending_only"
  on reservations for insert
  to anon
  with check (statut = 'en_attente');

-- Le public NE PEUT PAS lire les réservations directement (protège les
-- coordonnées des autres clients). Il passe par la vue ci-dessous à la place.
-- (Aucune policy "select" pour "anon" = accès refusé par défaut avec RLS actif.)

-- Seule la cliente connectée (compte admin) voit et modifie tout.
create policy "admin_select_all"
  on reservations for select
  to authenticated
  using (true);

create policy "admin_update_all"
  on reservations for update
  to authenticated
  using (true)
  with check (true);

-- =========================================================
-- Vue publique de disponibilité
-- Expose uniquement date + heure + statut des créneaux occupés,
-- jamais les coordonnées des clients — c'est ce que le site public
-- interroge pour savoir quels créneaux proposer.
-- =========================================================
create or replace view creneaux_pris as
  select date_seance, heure_seance
  from reservations
  where statut in ('en_attente', 'confirme');

grant select on creneaux_pris to anon;

-- =========================================================
-- Notes de déploiement (voir README.md pour le détail complet) :
-- 1. Créer le compte admin de la cliente dans
--    Dashboard > Authentication > Users > Add user (email + mot de passe).
--    C'est ce compte qui se connecte sur admin.html.
-- 2. Ne JAMAIS activer l'inscription publique (Auth > Providers) —
--    seul ce compte doit pouvoir se connecter.
-- =========================================================
