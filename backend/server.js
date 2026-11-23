'use strict';
// API MS Techniker : formulaire de contact, commandes de serveurs, espace admin.
// Node.js >= 22.5, aucune dépendance. Sert aussi le site statique.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ouvrir, STATUTS_COMMANDE, STATUTS_MESSAGE } = require('./db');
const { OFFRES, parId } = require('./offres');
const mailer = require('./mailer');

function config(env = process.env) {
  return {
    port: Number(env.PORT || 8080),
    dbPath: env.DB_PATH || path.join(__dirname, 'data', 'mstechniker.db'),
    siteRoot: path.resolve(env.SITE_ROOT || path.join(__dirname, '..')),
    adminToken: env.ADMIN_TOKEN || '',
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    mailTo: env.MAIL_TO || 'mstechniker96@gmail.com',
    confirmerClient: env.CONFIRMATION_CLIENT !== 'false',
    trustProxy: env.TRUST_PROXY === 'true',
    smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT || 465, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM },
  };
}

// ---------- utilitaires ----------
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;
const TEL = /^\+?[0-9 ().-]{6,22}$/;
const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function envoyerJson(res, code, data, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function lireJson(req, limite = 20 * 1024) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/i.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('Content-Type application/json attendu'), { code: 415 }));
    let taille = 0; const morceaux = [];
    req.on('data', (c) => {
      taille += c.length;
      if (taille > limite) { reject(Object.assign(new Error('Requête trop volumineuse'), { code: 413 })); req.destroy(); return; }
      morceaux.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON invalide'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

// Limite simple : N requêtes par fenêtre et par adresse IP (en mémoire).
function limiteur(max, fenetreMs) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const l = (hits.get(ip) || []).filter((t) => now - t < fenetreMs);
    l.push(now); hits.set(ip, l);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < fenetreMs)) hits.delete(k);
    return l.length <= max;
  };
}

function egaliteSure(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };

function creerApp(cfg = config(), deps = {}) {
  const store = deps.store || ouvrir(cfg.dbPath);
  const envoyerMail = deps.envoyerMail || ((m) => mailer.envoyer(cfg.smtp, m));
  const limiteForm = limiteur(5, 10 * 60 * 1000);
  const limiteAdmin = limiteur(60, 60 * 1000);

  const notifier = (m) => envoyerMail(m).catch((e) => console.error('[mail]', e.message));

  function ipDe(req) {
    if (cfg.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress || 'inconnue';
  }

  function cors(req) {
    const o = req.headers.origin;
    if (!o || !cfg.corsOrigins.length) return {};
    if (cfg.corsOrigins.includes('*') || cfg.corsOrigins.includes(o)) {
      return { 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
    }
    return {};
  }

  function admin(req) {
    if (!cfg.adminToken) return false;
    const h = req.headers.authorization || '';
    const jeton = h.startsWith('Bearer ') ? h.slice(7) : '';
    return jeton && egaliteSure(jeton, cfg.adminToken);
  }

  // ---------- routes API ----------
  async function api(req, res, url, entetes) {
    const r = url.pathname;
    const m = req.method;

    if (r === '/api/sante' && m === 'GET') return envoyerJson(res, 200, { ok: true, email: mailer.configure(cfg.smtp) }, entetes);
    if (r === '/api/offres' && m === 'GET') return envoyerJson(res, 200, { offres: OFFRES }, entetes);

    if (r === '/api/contact' && m === 'POST') {
      if (!limiteForm(ipDe(req))) return envoyerJson(res, 429, { erreur: 'Trop de messages envoyés. Réessayez dans quelques minutes.' }, entetes);
      const b = await lireJson(req);
      if (txt(b.site_web, 200)) return envoyerJson(res, 201, { ok: true }, entetes); // pot de miel anti-robots
      const msg = { nom: txt(b.nom, 120), email: txt(b.email, 200), telephone: txt(b.telephone, 30), sujet: txt(b.sujet, 150), message: txt(b.message, 4000) };
      const erreurs = {};
      if (msg.nom.length < 2) erreurs.nom = 'Indiquez votre nom.';
      if (!EMAIL.test(msg.email)) erreurs.email = 'Adresse e-mail invalide.';
      if (msg.telephone && !TEL.test(msg.telephone)) erreurs.telephone = 'Numéro invalide.';
      if (msg.message.length < 10) erreurs.message = 'Votre message est trop court (10 caractères minimum).';
      if (Object.keys(erreurs).length) return envoyerJson(res, 400, { erreur: 'Formulaire incomplet.', champs: erreurs }, entetes);
      const id = store.ajouterMessage(msg);
      notifier({
        to: cfg.mailTo, replyTo: msg.email,
        subject: `Nouveau message du site${msg.sujet ? ' : ' + msg.sujet : ''}`,
        text: `Message n° ${id}\n\nDe : ${msg.nom} <${msg.email}>\nTéléphone : ${msg.telephone || '-'}\nSujet : ${msg.sujet || '-'}\n\n${msg.message}\n`,
      });
      return envoyerJson(res, 201, { ok: true, id }, entetes);
    }

    if (r === '/api/commandes' && m === 'POST') {
      if (!limiteForm(ipDe(req))) return envoyerJson(res, 429, { erreur: 'Trop de demandes envoyées. Réessayez dans quelques minutes.' }, entetes);
      const b = await lireJson(req);
      if (txt(b.site_web, 200)) return envoyerJson(res, 201, { ok: true, reference: 'MST-0000' }, entetes);
      const offre = parId(b.offre);
      const duree = Number.parseInt(b.duree_mois, 10);
      const c = {
        nom: txt(b.nom, 120), entreprise: txt(b.entreprise, 150), email: txt(b.email, 200),
        telephone: txt(b.telephone, 30), usage: txt(b.usage, 2000),
        dureeMois: [1, 3, 6, 12].includes(duree) ? duree : NaN,
      };
      const erreurs = {};
      if (!offre) erreurs.offre = 'Choisissez une offre.';
      if (c.nom.length < 2) erreurs.nom = 'Indiquez votre nom.';
      if (!EMAIL.test(c.email)) erreurs.email = 'Adresse e-mail invalide.';
      if (!TEL.test(c.telephone)) erreurs.telephone = 'Numéro de téléphone requis.';
      if (Number.isNaN(c.dureeMois)) erreurs.duree_mois = 'Durée : 1, 3, 6 ou 12 mois.';
      if (Object.keys(erreurs).length) return envoyerJson(res, 400, { erreur: 'Formulaire incomplet.', champs: erreurs }, entetes);
      const { id, reference } = store.ajouterCommande({ ...c, offre: offre.id, prixUsd: offre.prixUsd });
      const total = offre.prixUsd * c.dureeMois;
      notifier({
        to: cfg.mailTo, replyTo: c.email,
        subject: `Commande ${reference} : offre ${offre.nom}`,
        text: `Nouvelle commande ${reference}\n\nOffre : ${offre.nom} (${offre.prixUsd} $/mois)\nDurée : ${c.dureeMois} mois, soit ${total} $\n\nClient : ${c.nom}\nEntreprise : ${c.entreprise || '-'}\nE-mail : ${c.email}\nTéléphone : ${c.telephone}\n\nUsage prévu :\n${c.usage || '-'}\n`,
      });
      if (cfg.confirmerClient) {
        notifier({
          to: c.email, replyTo: cfg.mailTo,
          subject: `MS Techniker : demande ${reference} bien reçue`,
          text: `Bonjour ${c.nom},\n\nNous avons bien reçu votre demande pour l'offre serveur ${offre.nom} (${offre.prixUsd} $/mois, ${c.dureeMois} mois).\nRéférence : ${reference}\n\nNotre équipe vous contacte rapidement pour la mise en service et le paiement.\n\nMS Techniker\nmstechniker96@gmail.com · +243 985 651 544 (WhatsApp)\n`,
        });
      }
      return envoyerJson(res, 201, { ok: true, reference, offre: offre.nom, total_usd: total }, entetes);
    }

    // ---------- admin ----------
    if (r.startsWith('/api/admin/')) {
      if (!limiteAdmin(ipDe(req))) return envoyerJson(res, 429, { erreur: 'Trop de requêtes.' }, entetes);
      if (!admin(req)) return envoyerJson(res, 401, { erreur: 'Jeton administrateur requis.' }, { ...entetes, 'WWW-Authenticate': 'Bearer' });
      if (r === '/api/admin/stats' && m === 'GET') return envoyerJson(res, 200, store.stats(), entetes);
      if (r === '/api/admin/commandes' && m === 'GET') return envoyerJson(res, 200, { commandes: store.listerCommandes() }, entetes);
      if (r === '/api/admin/messages' && m === 'GET') return envoyerJson(res, 200, { messages: store.listerMessages() }, entetes);
      let mm = r.match(/^\/api\/admin\/commandes\/(\d+)$/);
      if (mm && m === 'PATCH') {
        const b = await lireJson(req);
        if (b.statut !== undefined && !STATUTS_COMMANDE.includes(b.statut)) return envoyerJson(res, 400, { erreur: `Statut : ${STATUTS_COMMANDE.join(', ')}` }, entetes);
        const maj = store.majCommande(Number(mm[1]), { statut: b.statut, note: b.note_interne !== undefined ? txt(b.note_interne, 2000) : undefined });
        return maj ? envoyerJson(res, 200, maj, entetes) : envoyerJson(res, 404, { erreur: 'Commande introuvable.' }, entetes);
      }
      mm = r.match(/^\/api\/admin\/messages\/(\d+)$/);
      if (mm && m === 'PATCH') {
        const b = await lireJson(req);
        if (!STATUTS_MESSAGE.includes(b.statut)) return envoyerJson(res, 400, { erreur: `Statut : ${STATUTS_MESSAGE.join(', ')}` }, entetes);
        return store.majMessage(Number(mm[1]), b.statut) ? envoyerJson(res, 200, { ok: true }, entetes) : envoyerJson(res, 404, { erreur: 'Message introuvable.' }, entetes);
      }
    }
    return envoyerJson(res, 404, { erreur: 'Route inconnue.' }, entetes);
  }

  // ---------- fichiers statiques ----------
  function statique(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    if (p === '/admin' || p === '/admin/') p = '/backend/admin.html';
    else if (p.endsWith('/')) p += 'index.html';
    const interdit = /(^|\/)\.|^\/backend\/(?!admin\.html$)|\.db/i;
    const fichier = path.join(cfg.siteRoot, path.normalize(p).replace(/^([/\\])+/, ''));
    if (interdit.test(p) || !fichier.startsWith(cfg.siteRoot + path.sep)) { res.writeHead(404); return res.end('Introuvable'); }
    fs.stat(fichier, (err, s) => {
      if (err || !s.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
      const ext = path.extname(fichier).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        ...(p === '/backend/admin.html' ? { 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex' } : {}),
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(fichier).pipe(res);
    });
  }

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const entetes = cors(req);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'OPTIONS') { res.writeHead(204, entetes); return res.end(); }
        return await api(req, res, url, entetes);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return statique(req, res, url);
    } catch (e) {
      const code = e.code && Number.isInteger(e.code) ? e.code : 500;
      if (code === 500) console.error('[api]', e);
      if (!res.headersSent) envoyerJson(res, code, { erreur: code === 500 ? 'Erreur interne.' : e.message }, entetes);
    }
  });
  serveur.store = store;
  return serveur;
}

if (require.main === module) {
  const cfg = config();
  if (!cfg.adminToken) console.warn('[admin] ADMIN_TOKEN non défini : l\'espace admin est désactivé.');
  if (!mailer.configure(cfg.smtp)) console.warn('[mail] SMTP non configuré : les messages sont enregistrés mais aucun e-mail n\'est envoyé.');
  const s = creerApp(cfg);
  s.listen(cfg.port, () => console.log(`MS Techniker API : http://localhost:${cfg.port}`));
  const stop = () => s.close(() => { s.store.fermer(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

module.exports = { creerApp, config };
