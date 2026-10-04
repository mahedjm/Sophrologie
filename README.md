# Au fil de soi — Site de sophrologie (maquette)

Maquette statique HTML / CSS / JS pour une sophrologue exerçant en suivi
individuel, ateliers privés à domicile, séances de groupe ouvertes, et
interventions pour entreprises et collectivités (Marmandais). Aucune
dépendance, aucun framework — prête à être hébergée sur
**GitHub Pages** pour test et validation avec la cliente.

## Structure

```
sophrologie-site/
├── index.html                  Accueil (piliers de l'offre)
├── offres.html                 Particuliers, groupes & associations (tarifs + FAQ)
├── entreprises.html            Sophrologie en entreprise / établissements de santé (+ FAQ)
├── sophrologie-musique.html    Sophrologie & musique, la signature sonore (+ FAQ)
├── reservation.html            Réservation & paiement (tunnel à 3 formats)
├── a-propos.html                Qui suis-je
├── contact.html                 Coordonnées, zone d'intervention, FAQ, devis B2B
├── admin.html                  Tableau de bord privé (RDV, ateliers ouverts, devis)
├── payer.html                  Paiement (atteinte via le lien envoyé après confirmation)
├── annulation.html             Annulation en libre-service (lien envoyé après paiement)
├── merci.html                  Page d'atterrissage après paiement Stripe réussi
├── css/
│   ├── style.css                Design tokens + styles du site public
│   └── admin.css                 Styles du tableau de bord (réutilisés par payer/annulation/merci)
├── js/
│   ├── config.js                 Clés Supabase + jours fermés (à compléter)
│   ├── site.js                   Header, nav mobile, animations au scroll (toutes les pages)
│   ├── reservation.js            Tunnel de réservation à 3 formats (reservation.html)
│   ├── contact.js                Formulaire de devis B2B (contact.html)
│   ├── admin.js                  Connexion + validation RDV + ateliers ouverts + devis
│   ├── payer.js                  Crée la session Stripe et redirige vers le paiement
│   └── annulation.js             Aperçu + confirmation de l'annulation/remboursement
├── supabase/
│   ├── schema.sql                Tables, jauge, sécurité, colonnes paiement
│   ├── config.toml               verify_jwt=false pour les fonctions publiques
│   └── functions/
│       ├── notify-new-request/       Email à la sophrologue (nouvelle demande)
│       ├── notify-devis-request/     Email à la sophrologue (nouvelle demande de devis B2B)
│       ├── send-status-email/        Met à jour le statut + email au client (+ .ics, + lien de paiement)
│       ├── create-checkout-session/  Crée la session Stripe Checkout à la volée (individuel/atelier privé)
│       ├── create-atelier-reservation/ Réserve une place sur un atelier ouvert + paiement immédiat
│       ├── stripe-webhook/           Marque le paiement reçu + email (.ics + lien d'annulation)
│       ├── cancel-reservation/       Annulation en libre-service + remboursement automatique
│       └── send-reminders/           Rappel email la veille de chaque séance payée (tâche planifiée)
├── outils/seo.py              Régénère Open Graph + JSON-LD (FAQ, services) de chaque page
└── README.md
```

Après toute modification d'une FAQ ou d'une meta description, relancer
`python3 outils/seo.py` pour garder les données structurées à jour.

## Déployer sur GitHub Pages (test rapide)

```bash
cd sophrologie-site
git init
git add .
git commit -m "Maquette site sophrologie"
git branch -M main
git remote add origin https://github.com/<ton-compte>/<nom-repo>.git
git push -u origin main
```

Puis dans le repo GitHub : **Settings → Pages → Branch: main → /(root)** → Save.
Le site sera disponible à `https://<ton-compte>.github.io/<nom-repo>/` après
1-2 minutes.

## Contenu à remplacer avant mise en ligne réelle

Tout est signalé par un commentaire `<!-- ... -->` en haut d'`index.html`, en résumé :

- Nom de la sophrologue, bio, diplômes, année d'installation
- Coordonnées : téléphone, email, adresse (base pour les ateliers), SIRET
- Prestations, tarifs et formules (actuellement basés sur des fourchettes de
  marché réalistes en 2026 pour une petite ville : 45-60 €/séance individuelle
  en zone rurale, forfaits dégressifs -10 % à -16 %, ateliers privés à
  domicile à partir de 25 €/personne)
- Zone d'intervention (villes autour de Marmande)
- Avis clients (actuellement fictifs)
- Le monogramme SVG "ML" en section "Qui suis-je" → à remplacer par une vraie photo

## Réservation, ateliers et paiement : architecture

Le site utilise **Supabase** (base de données + authentification), **Resend**
(envoi d'emails) et **Stripe** (paiement en ligne), tous gratuits ou sans
abonnement à ce volume (Stripe prélève juste une commission par transaction).
Le front-end reste entièrement statique — il appelle Supabase directement en
API, donc ça fonctionne sur GitHub Pages comme sur n'importe quel hébergeur
choisi ensuite.

Le tunnel de `reservation.html` propose 3 formats, avec des règles différentes :

**1. Suivi individuel / atelier privé à domicile** (validation manuelle) :
1. Un client réserve un créneau → une ligne `en_attente` est créée dans
   `reservations`. La base empêche nativement deux réservations actives sur
   le même créneau (contrainte SQL, pas seulement une vérification JS).
2. La sophrologue reçoit un email de notification (`notify-new-request`).
3. Elle se connecte sur `admin.html`, ajuste le prix si besoin (utile pour
   un atelier privé "sur devis"), et clique sur **Confirmer** ou **Refuser**.
4. Si elle confirme, le client reçoit un email (avec un fichier `.ics` à
   ajouter à son calendrier) contenant un lien vers `payer.html`, qui crée
   une session Stripe et l'y redirige.
5. Une fois payé, `stripe-webhook` marque la réservation payée et envoie au
   client un lien vers `annulation.html` (+ `.ics`), valable à tout moment.

**2. Séance de groupe ouverte** (paiement immédiat, jauge en base) :
1. La sophrologue crée les créneaux récurrents depuis `admin.html` (titre,
   lieu, date/heure, nombre de places, prix/place) — table `ateliers_sessions`.
2. Le site public liste les séances encore ouvertes (vue
   `ateliers_disponibles`, places restantes calculées en direct).
3. Un client choisit une place et règle immédiatement en ligne — pas de
   validation manuelle. La fonction `create-atelier-reservation` fait
   l'inscription et crée la session Stripe en une seule opération côté
   serveur (le prix vient de la base, jamais du client) ; un trigger SQL
   (`check_atelier_capacity`) refuse l'inscription si la séance vient de se
   remplir entre-temps.
4. Une fois payé, même flux que ci-dessus (`stripe-webhook`, `.ics`, lien
   d'annulation).

**3. Devis B2B** (entreprises, mairies, CCAS, associations) :
Le formulaire de `contact.html#devis` insère une ligne dans `demandes_devis`
et déclenche un email à la sophrologue (`notify-devis-request`) — pas de
paiement en ligne, elle établit et envoie le devis elle-même.

**Rappels** : une tâche planifiée appelle chaque jour la fonction
`send-reminders`, qui e-maile les clients dont la séance (payée) a lieu le
lendemain.

**Annulation** : le remboursement est calculé automatiquement (intégral si
+24h avant la séance, 50% en deçà) et déclenché via l'API Stripe, sans
intervention manuelle de la sophrologue.

## Mise en place (à faire une seule fois)

### 1. Créer le projet Supabase
- Créer un compte sur [supabase.com](https://supabase.com) (gratuit) et un nouveau projet.
- Dans **SQL Editor**, exécuter le contenu de `supabase/schema.sql`.
- Dans **Authentication → Users**, cliquer sur **Add user** et créer le
  compte de la sophrologue (email + mot de passe) — c'est ce compte qui se
  connectera sur `admin.html`. Ne pas activer l'inscription publique.
- Dans **Project Settings → API**, récupérer :
  - `Project URL`
  - la clé `anon public`
  - (plus tard) la clé `service_role` — à ne jamais mettre dans le front

### 2. Compléter la configuration du site
Dans `js/config.js`, remplacer :
```js
const SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co';
const SUPABASE_ANON_KEY = 'VOTRE_CLE_ANON_PUBLIC';
```
par les vraies valeurs récupérées à l'étape précédente.

### 3. Créer un compte Resend (envoi d'emails)
- Créer un compte sur [resend.com](https://resend.com) (gratuit, 3000 emails/mois).
- Récupérer une clé API.
- Pour utiliser une adresse `contact@aufildesoi.fr`, il faut vérifier le nom
  de domaine dans Resend (ajout d'enregistrements DNS). En attendant, on
  peut envoyer depuis l'adresse de test `onboarding@resend.dev`.

### 4. Créer un compte Stripe (paiement en ligne)
- Créer un compte sur [stripe.com](https://stripe.com) (gratuit, commission
  par transaction seulement). Renseigner les infos de l'auto-entreprise
  (SIRET, IBAN) pour pouvoir activer le mode live plus tard.
- En attendant l'activation complète, le **mode test** de Stripe (clés
  commençant par `sk_test_...`) permet de tester tout le parcours sans vrai
  argent — voir la section Test plus bas.
- Récupérer la **clé secrète** (Developers → API keys → Secret key). Elle ne
  doit jamais apparaître dans le front-end, uniquement dans les secrets
  Supabase ci-dessous.

### 5. Déployer les Edge Functions
Nécessite le [CLI Supabase](https://supabase.com/docs/guides/cli) (`npm install -g supabase`) :
```bash
supabase login
supabase link --project-ref <votre-ref-projet>

supabase functions deploy notify-new-request
supabase functions deploy notify-devis-request
supabase functions deploy send-status-email
supabase functions deploy create-checkout-session
supabase functions deploy create-atelier-reservation
supabase functions deploy stripe-webhook
supabase functions deploy cancel-reservation
supabase functions deploy send-reminders

# Secrets partagés par les fonctions (email + paiement + rappels)
supabase secrets set RESEND_API_KEY=xxxxx
supabase secrets set FROM_EMAIL=onboarding@resend.dev
supabase secrets set NOTIFY_EMAIL=email-de-la-sophrologue@exemple.fr
supabase secrets set ADMIN_URL=https://votre-domaine.fr/admin.html
supabase secrets set SITE_URL=https://votre-domaine.fr
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxxxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxx   # voir étape 7
supabase secrets set CRON_SECRET=xxxxx                   # voir étape 8, une chaîne aléatoire au choix
```
`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement
par Supabase aux Edge Functions, pas besoin de les définir manuellement.
Le fichier `supabase/config.toml` désactive la vérification JWT par défaut
pour les fonctions appelées sans session utilisateur (Stripe, visiteur
anonyme, tâche planifiée) — rien à faire de plus, il est pris en compte
automatiquement au déploiement.

### 6. Brancher les notifications automatiques
Dans le dashboard Supabase : **Database → Webhooks → Create a new webhook**,
à créer deux fois :
- Table `reservations`, événement `INSERT`, fonction cible `notify-new-request`
- Table `demandes_devis`, événement `INSERT`, fonction cible `notify-devis-request`

À partir de là, chaque nouvelle demande (RDV ou devis) déclenche
automatiquement un email à la sophrologue, et chaque décision (`admin.html`)
déclenche l'email au client.

### 7. Brancher le webhook Stripe
Dans le dashboard Stripe : **Developers → Webhooks → Add endpoint**
- URL : `https://<votre-ref-projet>.functions.supabase.co/stripe-webhook`
- Événement à écouter : `checkout.session.completed` (uniquement)

Stripe affiche alors un secret de signature (`whsec_...`) à mettre dans
`STRIPE_WEBHOOK_SECRET` (étape 5). Pour tester en local avant la mise en
ligne définitive, `stripe listen --forward-to <url-de-la-fonction>` (CLI
Stripe) fournit un `whsec_...` temporaire équivalent.

### 8. Planifier les rappels quotidiens
Dans **Database → Extensions**, activer `pg_cron` et `pg_net`, puis dans le
**SQL Editor** :
```sql
select cron.schedule(
  'rappels-quotidiens',
  '0 8 * * *',  -- tous les jours à 8h UTC (9h ou 10h heure de Paris selon la saison)
  $$
  select net.http_post(
    url := 'https://<votre-ref-projet>.functions.supabase.co/send-reminders',
    headers := jsonb_build_object('x-cron-secret', '<la-valeur-de-CRON_SECRET>')
  );
  $$
);
```
(Le dashboard Supabase propose aussi une interface **Integrations → Cron
Jobs** pour faire la même chose sans SQL.)

### 9. Tester le parcours de paiement (mode test Stripe)
Aucune clé publique Stripe n'est nécessaire côté front — tout passe par une
page Stripe hébergée. Avec `STRIPE_SECRET_KEY` en mode test :
1. Réserver un créneau individuel sur `reservation.html`, le confirmer dans `admin.html`.
2. Ouvrir le lien `payer.html` reçu par email, payer avec la carte de test
   `4242 4242 4242 4242` (date future, CVC quelconque).
3. Vérifier l'arrivée sur `merci.html`, puis l'email (avec pièce jointe
   `.ics`) contenant le lien `annulation.html`, et que la ligne
   `reservations` a bien `paiement_statut = 'paye'`.
4. Tester l'annulation (remboursement visible dans le Dashboard Stripe).
5. Créer un atelier ouvert depuis `admin.html`, réserver une place sur
   `reservation.html` (format "Séance de groupe ouverte") : le paiement doit
   se déclencher immédiatement, sans étape de confirmation manuelle.
6. Tester le formulaire de devis sur `contact.html#devis` et vérifier la
   réception de l'email `notify-devis-request`.

Une fois le compte Stripe activé en production, remplacer `sk_test_...` par
la clé secrète live et refaire l'étape 7 avec l'endpoint de production.

## Limites actuelles / pistes d'amélioration
- Les horaires proposés sont fixes (`BASE_SLOTS` dans `js/reservation.js`) —
  pas encore de gestion d'horaires différents par jour de la semaine.
- Les jours de fermeture ponctuels se gèrent à la main via `CLOSED_DATES`
  dans `js/config.js` — une vraie table `exceptions` serait plus confortable
  à terme.
- Si un client ne va jamais au bout du paiement après confirmation (format
  individuel/atelier privé), le créneau reste bloqué : la sophrologue doit
  le libérer manuellement depuis `admin.html` (bouton "Libérer le créneau").
  Pas de purge automatique par tâche planifiée pour l'instant.
- Les rappels et les emails de confirmation restent en email uniquement
  (pas de SMS) et la "synchronisation calendrier" se limite à une pièce
  jointe `.ics` par email — pas de connexion OAuth à l'agenda pro de la
  cliente (Google Calendar / Outlook).
- Les emails de paiement font office de reçu détaillé, mais ne sont pas des
  factures numérotées légalement (pas de numérotation séquentielle ni de
  mentions SIRET/TVA automatiques) — à ajouter si la cliente ou son
  comptable en a besoin.
- Les créneaux des ateliers de groupe ouverts sont créés un par un depuis
  `admin.html` (pas de moteur de récurrence) — pour un atelier hebdomadaire
  récurrent, il faut créer chaque occurrence à l'avance.
