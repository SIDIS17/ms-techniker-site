# MS Techniker — site web et API

Site vitrine de **MS Techniker**, startup de Mont Ngafula (Kinshasa) : systèmes embarqués, IA, énergie intelligente, IoT et offres serveurs, avec un backend pour le **contact**, les **demandes de devis** (particuliers et entreprises) et les **commandes de serveurs**. Aucune dépendance npm.

## Structure
```
index.html              site (une page)
img/                    logos et photos
admin/index.html        tableau de bord /admin
api/index.js            fonction Vercel (toutes les routes /api/*)
api/_lib/core.js        logique de l'API (validation, e-mails, admin) — partagée
api/_lib/store-supabase.js   stockage Supabase (Vercel)
api/_lib/store-sqlite.js     stockage SQLite (Docker)
api/_lib/mailer.js      envoi SMTP (Gmail compatible)
api/_lib/offres.js      offres Starter / Business / Pro / Enterprise
supabase/schema.sql     tables, références, indicateurs, sécurité
backend/server.js       serveur autonome pour Docker
backend/test/           13 tests (npm test)
vercel.json, Dockerfile, docker-compose.yml, .env.example
```

## Routes
| Route | Rôle |
|---|---|
| `POST /api/contact` | message du site, envoyé à `MAIL_TO` |
| `POST /api/devis` | demande de devis particulier/entreprise, référence `DEV-AAAA-NNNN`, e-mails équipe + client |
| `POST /api/commandes` | commande de serveur, référence `MST-AAAA-NNNN`, e-mails équipe + client |
| `GET /api/offres`, `/api/services`, `/api/sante` | catalogue, options du devis, état |
| `/admin` | tableau de bord (jeton `ADMIN_TOKEN`) : devis (statut, montant, note), commandes, messages, indicateurs |

Protections : validation des champs, pot de miel anti-robots, limite d'envois par IP, corps limité à 20 Ko, base inaccessible au public (RLS Supabase), jeton admin comparé en temps constant.

---

## Déploiement sur Vercel + Supabase (recommandé)

### 1. Créer la base Supabase (gratuit)
1. supabase.com → **New project** (région la plus proche : Europe).
2. **SQL Editor → New query** → coller le contenu de `supabase/schema.sql` → **Run**.
3. **Project Settings → API** : noter **Project URL** et la clé **service_role** (secrète).

### 2. Importer le projet sur Vercel
1. vercel.com → **Add New… → Project** → importer `SIDIS17/ms-techniker-site`.
2. Framework Preset : **Other**, Root Directory `./`, pas de build.
3. **Environment Variables** :

| Nom | Valeur |
|---|---|
| `SUPABASE_URL` | Project URL Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | clé service_role |
| `ADMIN_TOKEN` | mot de passe long de l'admin (`openssl rand -hex 32`) |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `mstechniker96@gmail.com` |
| `SMTP_PASS` | mot de passe d'application Gmail (myaccount.google.com/apppasswords) |
| `MAIL_TO` | `mstechniker96@gmail.com` |

4. **Deploy**. Vérifier : `https://<projet>.vercel.app/api/sante` doit répondre `{"ok":true,…,"stockage":"supabase"}`.
5. Tableau de bord : `https://<projet>.vercel.app/admin`.

Chaque push sur `main` redéploie automatiquement. Les données sont aussi visibles dans Supabase → **Table Editor**.

---

## Déploiement Docker (serveur MS Techniker)
```bash
git clone https://github.com/SIDIS17/ms-techniker-site.git && cd ms-techniker-site
cp backend/.env.example backend/.env && nano backend/.env
docker compose up -d --build        # site + API + /admin sur le port 8080
```
Stockage SQLite dans le volume `mst-data`. Mettre un proxy HTTPS (Caddy : `mstechniker.cd { reverse_proxy localhost:8080 }`).

## En local
```bash
cd backend
ADMIN_TOKEN=test npm start          # http://localhost:8080 et /admin (SQLite)
npm test                            # 13 tests : Docker/SQLite et Vercel/Supabase
```

## Site et API sur deux domaines
Indiquer l'adresse de l'API dans `index.html` : `<meta name="mst-api" content="https://api.exemple.cd">` et ajouter le domaine du site dans `CORS_ORIGINS`. Si l'API ne répond pas, les formulaires proposent l'envoi par WhatsApp.

## Contact
mstechniker96@gmail.com · +243 985 651 544 (WhatsApp)
