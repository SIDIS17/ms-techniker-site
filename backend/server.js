'use strict';
// Serveur autonome (déploiement Docker) : site statique + API MS Techniker.
// Node.js >= 22.5, aucune dépendance. La logique de l'API est dans api/_lib/core.js.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { creerCoeur, configDepuisEnv } = require('../api/_lib/core');
const { ouvrir } = require('../api/_lib/store-sqlite');
const mailer = require('../api/_lib/mailer');

function config(env = process.env) {
  return {
    ...configDepuisEnv(env),
    port: Number(env.PORT || 8080),
    dbPath: env.DB_PATH || path.join(__dirname, 'data', 'mstechniker.db'),
    siteRoot: path.resolve(env.SITE_ROOT || path.join(__dirname, '..')),
    trustProxy: env.TRUST_PROXY === 'true',
  };
}

function lireJson(req, limite = 20 * 1024) {
  return new Promise((resolve) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return resolve({});
    if (!/application\/json/i.test(req.headers['content-type'] || '')) return resolve({ erreur: { code: 415, message: 'Content-Type application/json attendu' } });
    let taille = 0; const morceaux = []; let fini = false;
    req.on('data', (c) => {
      taille += c.length;
      if (taille > limite && !fini) { fini = true; resolve({ erreur: { code: 413, message: 'Requête trop volumineuse' } }); req.destroy(); return; }
      morceaux.push(c);
    });
    req.on('end', () => {
      if (fini) return;
      try { resolve({ corps: JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}') }); }
      catch { resolve({ erreur: { code: 400, message: 'JSON invalide' } }); }
    });
    req.on('error', () => resolve({ erreur: { code: 400, message: 'Requête interrompue' } }));
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const INTERDIT = /(^|\/)\.|^\/(backend|api|supabase)(\/|$)|\.(db|md|yml|json|sql)$|^\/Dockerfile$/i;

function creerApp(cfg = config(), deps = {}) {
  const store = deps.store || ouvrir(cfg.dbPath);
  const envoyerMail = deps.envoyerMail || ((m) => mailer.envoyer(cfg.smtp, m));
  const coeur = creerCoeur({ cfg, store, envoyerMail, smtpActif: mailer.configure(cfg.smtp) });

  function statique(req, res, url) {
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    if (p.endsWith('/')) p += 'index.html';
    else if (p === '/admin') p = '/admin/index.html';
    const fichier = path.join(cfg.siteRoot, path.normalize(p).replace(/^([/\\])+/, ''));
    if (INTERDIT.test(p) || !fichier.startsWith(cfg.siteRoot + path.sep)) { res.writeHead(404); return res.end('Introuvable'); }
    fs.stat(fichier, (err, s) => {
      if (err || !s.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
      const ext = path.extname(fichier).toLowerCase();
      const admin = p.startsWith('/admin/');
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        ...(admin ? { 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex' } : {}),
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(fichier).pipe(res);
    });
  }

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const { corps, erreur } = await lireJson(req);
      const ip = (cfg.trustProxy && req.headers['x-forwarded-for']) ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : (req.socket.remoteAddress || 'inconnue');
      const rep = await coeur.traiter({ method: req.method, path: url.pathname, headers: req.headers, ip, body: corps, erreurCorps: erreur });
      res.writeHead(rep.status, { ...(rep.data === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), 'Cache-Control': 'no-store', ...rep.headers });
      return res.end(rep.data === null ? undefined : JSON.stringify(rep.data));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return statique(req, res, url);
  });
  serveur.store = store;
  return serveur;
}

if (require.main === module) {
  const cfg = config();
  if (!cfg.adminToken) console.warn('[admin] ADMIN_TOKEN non défini : l\'espace admin est désactivé.');
  if (!mailer.configure(cfg.smtp)) console.warn('[mail] SMTP non configuré : les demandes sont enregistrées mais aucun e-mail n\'est envoyé.');
  const s = creerApp(cfg);
  s.listen(cfg.port, () => console.log(`MS Techniker : http://localhost:${cfg.port}  (admin : /admin)`));
  const stop = () => s.close(() => { s.store.fermer(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

module.exports = { creerApp, config };
