'use strict';
// Logique de l'API MS Techniker, indépendante du serveur :
// utilisée par backend/server.js (Docker) et par api/index.js (Vercel).
const crypto = require('node:crypto');
const { OFFRES, parId } = require('./offres');

const STATUTS_COMMANDE = ['nouvelle', 'en_cours', 'active', 'annulee'];
const STATUTS_MESSAGE = ['nouveau', 'traite'];
const STATUTS_DEVIS = ['nouveau', 'en_etude', 'envoye', 'accepte', 'refuse'];

const SERVICES = {
  energie: 'Énergie (micro-hydro, solaire, stockage)',
  embarque: 'Systèmes embarqués et automatisme',
  ia: 'Intelligence artificielle et données',
  iot: 'IoT et supervision à distance',
  serveurs: 'Serveurs, hébergement et cloud',
  web: 'Site web ou application',
  formation: 'Formation et accompagnement',
  autre: 'Autre besoin',
};
const BUDGETS = ['< 500 $', '500 – 2 000 $', '2 000 – 10 000 $', '> 10 000 $', 'À définir'];
const DELAIS = ['Urgent (< 1 mois)', '1 à 3 mois', 'Plus de 3 mois', 'Pas de date fixe'];
const TAILLES = ['1 à 10', '11 à 50', '51 à 250', 'Plus de 250'];

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;
const TEL = /^\+?[0-9 ().-]{6,22}$/;
const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function configDepuisEnv(env = process.env) {
  return {
    adminToken: env.ADMIN_TOKEN || '',
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    mailTo: env.MAIL_TO || 'mstechniker96@gmail.com',
    confirmerClient: env.CONFIRMATION_CLIENT !== 'false',
    limiteEnvois: Number(env.LIMITE_ENVOIS || 5),
    smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT || 465, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM },
  };
}

// Limite simple : N requêtes par fenêtre et par IP (mémoire de l'instance).
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

function creerCoeur({ cfg, store, envoyerMail, smtpActif = false }) {
  const limiteForm = limiteur(cfg.limiteEnvois || 5, 10 * 60 * 1000);
  const limiteAdmin = limiteur(60, 60 * 1000);
  // On attend les e-mails (indispensable en serverless), sans jamais faire échouer la requête.
  const notifier = async (liste) => {
    await Promise.all(liste.map((m) => Promise.race([
      envoyerMail(m),
      new Promise((r) => setTimeout(r, 8000)),
    ]).catch((e) => console.error('[mail]', e.message))));
  };

  function cors(origin) {
    if (!origin || !cfg.corsOrigins.length) return {};
    if (cfg.corsOrigins.includes('*') || cfg.corsOrigins.includes(origin)) {
      return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
    }
    return {};
  }

  const R = (status, data, headers = {}) => ({ status, data, headers });

  async function routes({ method: m, path: r, headers, ip, body }) {
    if (r === '/api/sante' && m === 'GET') return R(200, { ok: true, email: smtpActif, stockage: store.type });
    if (r === '/api/offres' && m === 'GET') return R(200, { offres: OFFRES });
    if (r === '/api/services' && m === 'GET') return R(200, { services: SERVICES, budgets: BUDGETS, delais: DELAIS, tailles: TAILLES });

    if (m === 'POST' && ['/api/contact', '/api/commandes', '/api/devis'].includes(r)) {
      if (!limiteForm(ip)) return R(429, { erreur: 'Trop d\'envois. Réessayez dans quelques minutes.' });
      const b = body || {};
      const robot = txt(b.site_web, 200);

      if (r === '/api/contact') {
        if (robot) return R(201, { ok: true });
        const msg = { nom: txt(b.nom, 120), email: txt(b.email, 200), telephone: txt(b.telephone, 30), sujet: txt(b.sujet, 150), message: txt(b.message, 4000) };
        const e = {};
        if (msg.nom.length < 2) e.nom = 'Indiquez votre nom.';
        if (!EMAIL.test(msg.email)) e.email = 'Adresse e-mail invalide.';
        if (msg.telephone && !TEL.test(msg.telephone)) e.telephone = 'Numéro invalide.';
        if (msg.message.length < 10) e.message = 'Votre message est trop court (10 caractères minimum).';
        if (Object.keys(e).length) return R(400, { erreur: 'Formulaire incomplet.', champs: e });
        const id = await store.ajouterMessage(msg);
        await notifier([{
          to: cfg.mailTo, replyTo: msg.email,
          subject: `Nouveau message du site${msg.sujet ? ' : ' + msg.sujet : ''}`,
          text: `Message n° ${id}\n\nDe : ${msg.nom} <${msg.email}>\nTéléphone : ${msg.telephone || '-'}\nSujet : ${msg.sujet || '-'}\n\n${msg.message}\n`,
        }]);
        return R(201, { ok: true, id });
      }

      if (r === '/api/commandes') {
        if (robot) return R(201, { ok: true, reference: 'MST-0000' });
        const offre = parId(b.offre);
        const duree = Number.parseInt(b.duree_mois, 10);
        const c = {
          nom: txt(b.nom, 120), entreprise: txt(b.entreprise, 150), email: txt(b.email, 200),
          telephone: txt(b.telephone, 30), usage: txt(b.usage, 2000),
          dureeMois: [1, 3, 6, 12].includes(duree) ? duree : NaN,
        };
        const e = {};
        if (!offre) e.offre = 'Choisissez une offre.';
        if (c.nom.length < 2) e.nom = 'Indiquez votre nom.';
        if (!EMAIL.test(c.email)) e.email = 'Adresse e-mail invalide.';
        if (!TEL.test(c.telephone)) e.telephone = 'Numéro de téléphone requis.';
        if (Number.isNaN(c.dureeMois)) e.duree_mois = 'Durée : 1, 3, 6 ou 12 mois.';
        if (Object.keys(e).length) return R(400, { erreur: 'Formulaire incomplet.', champs: e });
        const { reference } = await store.ajouterCommande({ ...c, offre: offre.id, prixUsd: offre.prixUsd });
        const total = offre.prixUsd * c.dureeMois;
        const mails = [{
          to: cfg.mailTo, replyTo: c.email,
          subject: `Commande ${reference} : offre ${offre.nom}`,
          text: `Nouvelle commande ${reference}\n\nOffre : ${offre.nom} (${offre.prixUsd} $/mois)\nDurée : ${c.dureeMois} mois, soit ${total} $\n\nClient : ${c.nom}\nEntreprise : ${c.entreprise || '-'}\nE-mail : ${c.email}\nTéléphone : ${c.telephone}\n\nUsage prévu :\n${c.usage || '-'}\n`,
        }];
        if (cfg.confirmerClient) mails.push({
          to: c.email, replyTo: cfg.mailTo,
          subject: `MS Techniker : demande ${reference} bien reçue`,
          text: `Bonjour ${c.nom},\n\nNous avons bien reçu votre demande pour l'offre serveur ${offre.nom} (${offre.prixUsd} $/mois, ${c.dureeMois} mois).\nRéférence : ${reference}\n\nNotre équipe vous contacte rapidement pour la mise en service et le paiement.\n\nMS Techniker\nmstechniker96@gmail.com · +243 985 651 544 (WhatsApp)\n`,
        });
        await notifier(mails);
        return R(201, { ok: true, reference, offre: offre.nom, total_usd: total });
      }

      // /api/devis
      if (robot) return R(201, { ok: true, reference: 'DEV-0000' });
      const d = {
        typeClient: ['entreprise', 'particulier'].includes(b.type_client) ? b.type_client : '',
        service: SERVICES[b.service] ? b.service : '',
        description: txt(b.description, 5000),
        budget: BUDGETS.includes(b.budget) ? b.budget : '',
        delai: DELAIS.includes(b.delai) ? b.delai : '',
        localisation: txt(b.localisation, 150),
        nom: txt(b.nom, 120), email: txt(b.email, 200), telephone: txt(b.telephone, 30),
        entreprise: txt(b.entreprise, 150), secteur: txt(b.secteur, 120),
        taille: TAILLES.includes(b.taille) ? b.taille : '', fonction: txt(b.fonction, 120),
      };
      const e = {};
      if (!d.typeClient) e.type_client = 'Particulier ou entreprise ?';
      if (!d.service) e.service = 'Choisissez un service.';
      if (d.description.length < 20) e.description = 'Décrivez votre besoin (20 caractères minimum).';
      if (d.nom.length < 2) e.nom = 'Indiquez votre nom.';
      if (!EMAIL.test(d.email)) e.email = 'Adresse e-mail invalide.';
      if (!TEL.test(d.telephone)) e.telephone = 'Numéro de téléphone requis.';
      if (d.typeClient === 'entreprise' && d.entreprise.length < 2) e.entreprise = 'Indiquez le nom de l\'entreprise.';
      if (Object.keys(e).length) return R(400, { erreur: 'Formulaire incomplet.', champs: e });
      if (d.typeClient === 'particulier') { d.entreprise = ''; d.secteur = ''; d.taille = ''; d.fonction = ''; }
      const { reference } = await store.ajouterDevis(d);
      const qui = d.typeClient === 'entreprise' ? `${d.entreprise} (${d.nom}${d.fonction ? ', ' + d.fonction : ''})` : `${d.nom} (particulier)`;
      const mails = [{
        to: cfg.mailTo, replyTo: d.email,
        subject: `Demande de devis ${reference} : ${SERVICES[d.service]}`,
        text: `Nouvelle demande de devis ${reference}\n\nClient : ${qui}\n` +
          (d.typeClient === 'entreprise' ? `Secteur : ${d.secteur || '-'}\nTaille : ${d.taille || '-'}\n` : '') +
          `E-mail : ${d.email}\nTéléphone : ${d.telephone}\nLocalisation : ${d.localisation || '-'}\n\n` +
          `Service : ${SERVICES[d.service]}\nBudget : ${d.budget || '-'}\nDélai : ${d.delai || '-'}\n\nBesoin :\n${d.description}\n`,
      }];
      if (cfg.confirmerClient) mails.push({
        to: d.email, replyTo: cfg.mailTo,
        subject: `MS Techniker : demande de devis ${reference} reçue`,
        text: `Bonjour ${d.nom},\n\nNous avons bien reçu votre demande de devis (${SERVICES[d.service]}).\nRéférence : ${reference}\n\nUn membre de l'équipe étudie votre besoin et vous recontacte rapidement.\n\nMS Techniker\nmstechniker96@gmail.com · +243 985 651 544 (WhatsApp)\n`,
      });
      await notifier(mails);
      return R(201, { ok: true, reference });
    }

    // ---------- admin ----------
    if (r.startsWith('/api/admin/')) {
      if (!limiteAdmin(ip)) return R(429, { erreur: 'Trop de requêtes.' });
      const h = headers.authorization || '';
      const jeton = h.startsWith('Bearer ') ? h.slice(7) : '';
      if (!cfg.adminToken || !jeton || !egaliteSure(jeton, cfg.adminToken)) return R(401, { erreur: 'Jeton administrateur requis.' }, { 'WWW-Authenticate': 'Bearer' });
      const b = body || {};
      if (r === '/api/admin/stats' && m === 'GET') return R(200, await store.stats());
      if (r === '/api/admin/commandes' && m === 'GET') return R(200, { commandes: await store.listerCommandes() });
      if (r === '/api/admin/messages' && m === 'GET') return R(200, { messages: await store.listerMessages() });
      if (r === '/api/admin/devis' && m === 'GET') return R(200, { devis: await store.listerDevis(), services: SERVICES });
      let mm = r.match(/^\/api\/admin\/commandes\/(\d+)$/);
      if (mm && m === 'PATCH') {
        if (b.statut !== undefined && !STATUTS_COMMANDE.includes(b.statut)) return R(400, { erreur: `Statut : ${STATUTS_COMMANDE.join(', ')}` });
        const maj = await store.majCommande(Number(mm[1]), { statut: b.statut, note: b.note_interne !== undefined ? txt(b.note_interne, 2000) : undefined });
        return maj ? R(200, maj) : R(404, { erreur: 'Commande introuvable.' });
      }
      mm = r.match(/^\/api\/admin\/messages\/(\d+)$/);
      if (mm && m === 'PATCH') {
        if (!STATUTS_MESSAGE.includes(b.statut)) return R(400, { erreur: `Statut : ${STATUTS_MESSAGE.join(', ')}` });
        return (await store.majMessage(Number(mm[1]), b.statut)) ? R(200, { ok: true }) : R(404, { erreur: 'Message introuvable.' });
      }
      mm = r.match(/^\/api\/admin\/devis\/(\d+)$/);
      if (mm && m === 'PATCH') {
        if (b.statut !== undefined && !STATUTS_DEVIS.includes(b.statut)) return R(400, { erreur: `Statut : ${STATUTS_DEVIS.join(', ')}` });
        let montant;
        if (b.montant_usd !== undefined && b.montant_usd !== null && b.montant_usd !== '') {
          montant = Number.parseInt(b.montant_usd, 10);
          if (!Number.isFinite(montant) || montant < 0) return R(400, { erreur: 'Montant invalide.' });
        }
        const maj = await store.majDevis(Number(mm[1]), { statut: b.statut, montant, note: b.note_interne !== undefined ? txt(b.note_interne, 2000) : undefined });
        return maj ? R(200, maj) : R(404, { erreur: 'Demande introuvable.' });
      }
    }
    return R(404, { erreur: 'Route inconnue.' });
  }

  async function traiter(req) {
    const entetes = cors(req.headers.origin);
    if (req.method === 'OPTIONS') return { status: 204, data: null, headers: entetes };
    if (req.erreurCorps) return { status: req.erreurCorps.code, data: { erreur: req.erreurCorps.message }, headers: entetes };
    try {
      const rep = await routes(req);
      return { ...rep, headers: { ...entetes, ...rep.headers } };
    } catch (e) {
      console.error('[api]', e);
      return { status: 500, data: { erreur: 'Erreur interne.' }, headers: entetes };
    }
  }

  return { traiter };
}

module.exports = { creerCoeur, configDepuisEnv, SERVICES, BUDGETS, DELAIS, TAILLES, STATUTS_COMMANDE, STATUTS_MESSAGE, STATUTS_DEVIS };
