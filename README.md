# Au fil de soi — Site de sophrologie (maquette)

Maquette statique HTML / CSS / JS pour un site de sophrologue (suivi individuel
en visio, séances de groupe chez un particulier, zone de Marmande). Aucune
dépendance, aucun framework — prête à être hébergée sur
**GitHub Pages** pour test et validation avec la cliente.

## Structure

```
sophrologie-site/
├── index.html                  Page publique (toutes les sections)
├── admin.html                  Tableau de bord privé (validation des RDV)
├── css/
│   ├── style.css                Design tokens + styles du site public
│   └── admin.css                 Styles du tableau de bord
├── js/
│   ├── config.js                 Clés Supabase + jours fermés (à compléter)
│   ├── script.js                 Navigation, animations, réservation
│   └── admin.js                  Connexion + validation/refus des demandes
├── supabase/
│   ├── schema.sql                Table, contrainte anti-doublon, sécurité
│   └── functions/
│       ├── notify-new-request/    Email à la sophrologue (nouvelle demande)
│       └── send-status-email/     Met à jour le statut + email au client
└── README.md
```

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

Tout est signalé par un commentaire `<!-- ... -->` en haut du `index.html`, en résumé :

- Nom de la sophrologue, bio, diplômes, année d'installation
- Coordonnées : téléphone, email, adresse (base pour les séances de groupe), SIRET
- Prestations, tarifs et formules (actuellement basés sur des fourchettes de
  marché réalistes en 2026 pour une petite ville : 45-60 €/séance individuelle
  en zone rurale, forfaits dégressifs -10 % à -16 %, séances de groupe chez un
  particulier sur devis à partir de 25 €/personne)
- Zone d'intervention (villes autour de Marmande)
- Avis clients (actuellement fictifs)
- Le monogramme SVG "CV" en section "Qui suis-je" → à remplacer par une vraie photo

## Réservation : architecture

Le site utilise **Supabase** (base de données + authentification) et
**Resend** (envoi d'emails), tous deux gratuits à ce volume. Le front-end
reste entièrement statique — il appelle Supabase directement en API, donc
ça fonctionne sur GitHub Pages comme sur n'importe quel hébergeur choisi
ensuite.

**Fonctionnement :**
1. Un client réserve un créneau sur le site → une ligne est créée dans la
   table `reservations` avec le statut `en_attente`.
2. La base de données empêche nativement deux réservations actives sur le
   même créneau (contrainte SQL, pas seulement une vérification JS).
3. La sophrologue reçoit un email de notification.
4. Elle se connecte sur `admin.html` et clique sur **Confirmer** ou **Refuser**.
5. Le client reçoit automatiquement un email avec la décision.

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

### 4. Déployer les Edge Functions
Nécessite le [CLI Supabase](https://supabase.com/docs/guides/cli) (`npm install -g supabase`) :
```bash
supabase login
supabase link --project-ref <votre-ref-projet>

supabase functions deploy notify-new-request
supabase functions deploy send-status-email

# Secrets partagés par les deux fonctions
supabase secrets set RESEND_API_KEY=xxxxx
supabase secrets set FROM_EMAIL=onboarding@resend.dev
supabase secrets set NOTIFY_EMAIL=email-de-la-sophrologue@exemple.fr
supabase secrets set ADMIN_URL=https://votre-domaine.fr/admin.html
```
`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement
par Supabase aux Edge Functions, pas besoin de les définir manuellement.

### 5. Brancher la notification automatique
Dans le dashboard Supabase : **Database → Webhooks → Create a new webhook**
- Table : `reservations`
- Événement : `INSERT`
- Type : `Supabase Edge Functions`
- Fonction cible : `notify-new-request`

À partir de là, chaque nouvelle demande déclenche automatiquement l'email
à la sophrologue, et chaque décision (`admin.html`) déclenche l'email au client.

## Limites actuelles / pistes d'amélioration
- Les horaires proposés sont fixes (`BASE_SLOTS` dans `js/script.js`) — pas
  encore de gestion d'horaires différents par jour de la semaine.
- Les jours de fermeture ponctuels se gèrent à la main via `CLOSED_DATES`
  dans `js/config.js` — une vraie table `exceptions` serait plus confortable
  à terme.
- Pas d'annulation en libre-service par le client — à ajouter si besoin
  (lien de gestion envoyé dans l'email de confirmation).
