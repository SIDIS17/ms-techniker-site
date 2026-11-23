'use strict';
// Fonction Vercel : toutes les routes /api/* arrivent ici (voir vercel.json).
// Stockage : Supabase (variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY).
const { creerCoeur, configDepuisEnv } = require('./_lib/core');
const { creerStoreSupabase } = require('./_lib/store-supabase');
const mailer = require('./_lib/mailer');

let coeur = null;
function obtenirCoeur() {
  if (coeur) return coeur;
  const cfg = configDepuisEnv(process.env);
  const store = creerStoreSupabase({ url: process.env.SUPABASE_URL, cle: process.env.SUPABASE_SERVICE_ROLE_KEY });
  coeur = creerCoeur({ cfg, store, envoyerMail: (m) => mailer.envoyer(cfg.smtp, m), smtpActif: mailer.configure(cfg.smtp) });
  return coeur;
}

function cheminDe(req) {
  const q = req.query && req.query.route;
  if (q !== undefined) return '/api/' + (Array.isArray(q) ? q.join('/') : String(q)).replace(/^\/+/, '');
  return new URL(req.url, 'http://x').pathname;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let c;
  try { c = obtenirCoeur(); } catch (e) {
    console.error('[config]', e.message);
    return res.status(503).json({ erreur: 'API non configurée (variables Supabase manquantes).' });
  }
  let body = {}; let erreurCorps;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (!/application\/json/i.test(req.headers['content-type'] || '')) erreurCorps = { code: 415, message: 'Content-Type application/json attendu' };
    else if (Number(req.headers['content-length'] || 0) > 20 * 1024) erreurCorps = { code: 413, message: 'Requête trop volumineuse' };
    else { try { body = req.body || {}; } catch { erreurCorps = { code: 400, message: 'JSON invalide' }; } }
  }
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnue';
  const rep = await c.traiter({ method: req.method, path: cheminDe(req), headers: req.headers, ip, body, erreurCorps });
  for (const [k, v] of Object.entries(rep.headers || {})) res.setHeader(k, v);
  if (rep.data === null) return res.status(rep.status).end();
  return res.status(rep.status).json(rep.data);
};
