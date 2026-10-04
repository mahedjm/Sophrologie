-- =========================================================
-- SO-BIOSE — Schéma Supabase
-- À exécuter dans : Dashboard Supabase > SQL Editor > New query
-- =========================================================

-- Séances de groupe ouvertes (créneaux récurrents à places limitées,
-- créés à la main par la cliente depuis admin.html — pas de moteur de
-- récurrence, une ligne = une occurrence précise).
create table if not exists ateliers_sessions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  titre         text not null,              -- ex: "Atelier gestion du stress"
  lieu          text not null,
  date_seance   date not null,
  heure_seance  text not null,              -- format 'HH:MM'
  capacite_max  int not null check (capacite_max > 0),
  prix_place    numeric not null,
  statut        text not null default 'ouvert' check (statut in ('ouvert', 'annule'))
);

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
                check (statut in ('en_attente', 'confirme', 'refuse', 'annule')),

  -- Paiement en ligne (Stripe) -------------------------------------------
  paiement_statut         text not null default 'non_requis'
                          check (paiement_statut in ('non_requis', 'en_attente_paiement', 'paye', 'rembourse', 'rembourse_partiel')),
  pay_token               uuid unique not null default gen_random_uuid(),    -- lien de paiement (payer.html)
  cancel_token            uuid unique not null default gen_random_uuid(),    -- lien d'annulation en libre-service (annulation.html)
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  montant_rembourse       numeric,

  -- Ateliers de groupe (privés à domicile ou séances ouvertes) --------------
  atelier_session_id  uuid references ateliers_sessions(id),  -- null pour les flux individuels/duo/forfaits/groupe privé
  nombre_participants  int not null default 1,                -- taille du groupe (privé) ou toujours 1 (place sur atelier ouvert)
  rappel_envoye        boolean not null default false
);

-- Migration pour une base déjà existante (le create table ci-dessus ne
-- s'applique qu'à une création initiale) :
-- alter table reservations add column if not exists paiement_statut text not null default 'non_requis'
--   check (paiement_statut in ('non_requis', 'en_attente_paiement', 'paye', 'rembourse', 'rembourse_partiel'));
-- alter table reservations add column if not exists pay_token uuid unique not null default gen_random_uuid();
-- alter table reservations add column if not exists cancel_token uuid unique not null default gen_random_uuid();
-- alter table reservations add column if not exists stripe_checkout_session_id text;
-- alter table reservations add column if not exists stripe_payment_intent_id text;
-- alter table reservations add column if not exists montant_rembourse numeric;
-- alter table reservations add column if not exists atelier_session_id uuid references ateliers_sessions(id);
-- alter table reservations add column if not exists nombre_participants int not null default 1;
-- alter table reservations add column if not exists rappel_envoye boolean not null default false;

-- Empêche deux réservations ACTIVES (en_attente ou confirmé) sur le même
-- créneau : c'est la vraie protection anti-double-réservation, au niveau
-- base de données (pas seulement côté JavaScript). Ne s'applique qu'aux
-- flux "un créneau = une réservation" (individuel, duo, forfaits, groupe
-- privé) — les séances de groupe ouvertes acceptent plusieurs réservations
-- sur le même créneau (une par place), protégées par le trigger de
-- capacité ci-dessous à la place.
create unique index if not exists reservations_creneau_actif
  on reservations (date_seance, heure_seance)
  where statut in ('en_attente', 'confirme') and atelier_session_id is null;

-- Index pour accélérer les requêtes de disponibilité
create index if not exists reservations_date_idx on reservations (date_seance);
create index if not exists reservations_atelier_idx on reservations (atelier_session_id);

-- =========================================================
-- Sécurité (Row Level Security)
-- =========================================================
alter table reservations enable row level security;

-- N'importe quel visiteur du site peut CRÉER une demande de réservation,
-- mais uniquement avec le statut "en_attente" (il ne peut pas s'auto-confirmer).
-- Les réservations sur une séance de groupe ouverte (auto-confirmées, paiement
-- immédiat) ne passent jamais par cette policy : elles sont insérées côté
-- serveur par la fonction create-atelier-reservation (clé service_role, qui
-- contourne RLS) — c'est aussi la seule façon pour le client de relire le
-- pay_token juste après l'insertion, puisque anon n'a aucune policy SELECT
-- sur cette table.
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
-- Capacité des séances de groupe ouvertes
-- -----------------------------------------------------------
-- Protège contre le surbooking au niveau base de données : une place ne
-- peut être réservée que si la somme des participants déjà actifs sur
-- cet atelier (en_attente ou confirmé) plus la nouvelle réservation ne
-- dépasse pas sa capacité maximale.
-- =========================================================
create or replace function check_atelier_capacity() returns trigger as $$
declare
  cap int;
  reserved int;
begin
  if new.atelier_session_id is null or new.statut not in ('en_attente', 'confirme') then
    return new;
  end if;

  select capacite_max into cap from ateliers_sessions where id = new.atelier_session_id;
  if cap is null then
    raise exception 'Séance introuvable';
  end if;

  select coalesce(sum(nombre_participants), 0) into reserved
    from reservations
    where atelier_session_id = new.atelier_session_id
      and statut in ('en_attente', 'confirme')
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if reserved + new.nombre_participants > cap then
    raise exception 'Cette séance est complète';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_atelier_capacity on reservations;
create trigger trg_check_atelier_capacity
  before insert or update on reservations
  for each row execute function check_atelier_capacity();

-- =========================================================
-- Sécurité (RLS) — ateliers_sessions
-- Créés et gérés uniquement par la cliente connectée ; le public ne les
-- consulte qu'au travers de la vue "ateliers_disponibles" ci-dessous.
-- =========================================================
alter table ateliers_sessions enable row level security;

create policy "admin_select_ateliers"
  on ateliers_sessions for select
  to authenticated
  using (true);

create policy "admin_write_ateliers"
  on ateliers_sessions for insert
  to authenticated
  with check (true);

create policy "admin_update_ateliers"
  on ateliers_sessions for update
  to authenticated
  using (true)
  with check (true);

-- Vue publique : séances ouvertes à venir avec leurs places restantes.
-- C'est elle que reservation.html interroge pour lister les créneaux de
-- groupe ouverts au public, sans jamais exposer les coordonnées des
-- personnes déjà inscrites.
create or replace view ateliers_disponibles as
  select
    s.id, s.titre, s.lieu, s.date_seance, s.heure_seance, s.prix_place, s.capacite_max,
    s.capacite_max - coalesce(sum(r.nombre_participants) filter (where r.statut in ('en_attente', 'confirme')), 0) as places_restantes
  from ateliers_sessions s
  left join reservations r on r.atelier_session_id = s.id
  where s.statut = 'ouvert' and s.date_seance >= current_date
  group by s.id
  having s.capacite_max - coalesce(sum(r.nombre_participants) filter (where r.statut in ('en_attente', 'confirme')), 0) > 0;

grant select on ateliers_disponibles to anon;

-- =========================================================
-- Demandes de devis (entreprises, mairies, CCAS, associations…)
-- Simple formulaire de contact B2B : pas de paiement en ligne associé,
-- la cliente rappelle/envoie le devis elle-même en dehors du site.
-- =========================================================
create table if not exists demandes_devis (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  type_structure     text not null check (type_structure in ('mairie', 'ccas', 'association', 'entreprise', 'sante', 'autre')),
  nom_structure      text not null,
  contact_prenom     text not null,
  contact_nom        text not null,
  email              text not null,
  telephone          text not null,
  nombre_personnes   text,               -- estimation libre, ex "environ 15"
  message            text,
  statut             text not null default 'nouvelle' check (statut in ('nouvelle', 'traitee'))
);

alter table demandes_devis enable row level security;

create policy "public_insert_devis"
  on demandes_devis for insert
  to anon
  with check (statut = 'nouvelle');

create policy "admin_select_devis"
  on demandes_devis for select
  to authenticated
  using (true);

create policy "admin_update_devis"
  on demandes_devis for update
  to authenticated
  using (true)
  with check (true);

-- =========================================================
-- Notes de déploiement (voir README.md pour le détail complet) :
-- 1. Créer le compte admin de la cliente dans
--    Dashboard > Authentication > Users > Add user (email + mot de passe).
--    C'est ce compte qui se connecte sur admin.html.
-- 2. Ne JAMAIS activer l'inscription publique (Auth > Providers) —
--    seul ce compte doit pouvoir se connecter.
-- =========================================================
