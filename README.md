# MS Techniker — site web et API

Site vitrine de **MS Techniker**, startup de Mont Ngafula (Kinshasa) : systèmes embarqués, IA, énergie intelligente, IoT et offres serveurs. Le dépôt contient aussi un **backend** pour le formulaire de contact et les commandes de serveurs.

## Structure
```
index.html            site (une page, HTML/CSS/JS intégrés)
img/                  logos et photos
backend/
  server.js           API + service du site statique (Node.js ≥ 22.5, aucune dépendance)
  db.js               base SQLite intégrée (node:sqlite)
  mailer.js           envoi d'e-mails SMTP (Gmail compatible)
  offres.js           catalogue Starter / Business / Pro / Enterprise
  admin.html          tableau de bord /admin
  test/api.test.js    tests (npm test)
  .env.example        configuration à copier en .env
Dockerfile, docker-compose.yml
```

## Ce que fait le backend
| Route | Rôle |
|---|---|
| `POST /api/contact` | enregistre un message du site et l'envoie à `MAIL_TO` |
| `POST /api/commandes` | enregistre une demande de serveur, renvoie une référence `MST-AAAA-NNNN`, prévient l'équipe et confirme au client par e-mail |
| `POST /api/devis` | demande de devis d'un particulier ou d'une entreprise, référence `DEV-AAAA-NNNN`, e-mails à l'équipe et au client |
| `GET /api/offres` | liste des offres et prix |
| `GET /api/services` | services, budgets et délais proposés dans le formulaire de devis |
| `GET /api/sante` | état du service |
| `/admin` | tableau de bord protégé par `ADMIN_TOKEN` : devis (statut, montant, note), commandes, messages, revenu mensuel actif, montant des devis acceptés |

Protections : validation des champs, pot de miel anti-robots, limite de 5 envois par IP toutes les 10 minutes, requêtes limitées à 20 Ko, requêtes SQL paramétrées, jeton admin comparé en temps constant, fichiers du backend et base jamais servis.

## Lancer en local
```bash
cd backend
cp .env.example .env        # puis remplir ADMIN_TOKEN (et SMTP_PASS pour les e-mails)
set -a; . ./.env; set +a
npm start                   # http://localhost:8080  et  http://localhost:8080/admin
npm test                    # 11 tests
```
Sans `SMTP_PASS`, tout fonctionne mais aucun e-mail n'est envoyé (les demandes restent visibles dans /admin).

## Déployer sur un serveur MS Techniker (Docker)
```bash
git clone https://github.com/SIDIS17/ms-techniker-site.git && cd ms-techniker-site
cp backend/.env.example backend/.env && nano backend/.env
docker compose up -d --build
```
Le site et l'API répondent sur le port 8080. Placer devant un proxy HTTPS (Caddy ou Nginx) pour le domaine, par ex. avec Caddy :
```
mstechniker.cd {
  reverse_proxy localhost:8080
}
```
La base SQLite est conservée dans le volume Docker `mst-data`. Sauvegarde : `docker cp mstechniker:/data/mstechniker.db ./sauvegarde.db`.

## Site sur GitHub Pages, API sur le serveur
Si le site reste sur GitHub Pages, indiquer l'adresse de l'API dans `index.html` :
```html
<meta name="mst-api" content="https://api.mstechniker.cd">
```
et ajouter `https://sidis17.github.io` dans `CORS_ORIGINS`. Si l'API ne répond pas, les formulaires proposent automatiquement d'envoyer la demande par WhatsApp.

## Déployer le site sur Vercel
1. vercel.com → **Add New… → Project** → importer `SIDIS17/ms-techniker-site` (un dépôt privé fonctionne).
2. Framework Preset : **Other** · Root Directory : `./` · pas de commande de build · **Deploy**.

`vercel.json` règle le cache des images ; `.vercelignore` exclut le dossier `backend/`, qui n'est pas publié sur Vercel.
Les formulaires (contact, devis, commandes) passent par WhatsApp tant qu'aucune API n'est indiquée dans `<meta name="mst-api">`. Pour les relier au backend hébergé sur le serveur MS Techniker, renseigner son adresse dans cette balise et ajouter le domaine Vercel dans `CORS_ORIGINS`.

## Contact
mstechniker96@gmail.com · +243 985 651 544 (WhatsApp)
