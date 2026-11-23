'use strict';
// Teste le chemin Vercel : api/index.js + store Supabase, contre un faux PostgREST.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// ---- faux Supabase (sous-ensemble de PostgREST utilisé par store-supabase.js) ----
const tables = { messages: [], commandes: [], devis: [] };
const vus = [];
let fauxSupabase, urlSupabase;
function refDe(t, id) { const p = t === 'commandes' ? 'MST' : t === 'devis' ? 'DEV' : null; return p ? `${p}-${new Date().getUTCFullYear()}-${String(id).padStart(4, '0')}` : undefined; }

before(async () => {
  fauxSupabase = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      vus.push({ m: req.method, u: req.url, key: req.headers.apikey, auth: req.headers.authorization });
      const u = new URL(req.url, 'http://x');
      const t = u.pathname.replace('/rest/v1/', '');
      const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.headers.apikey !== 'cle-service') return send(401, { message: 'bad key' });
      if (t === 'stats') {
        const c = tables.commandes, d = tables.devis, m = tables.messages;
        return send(200, [{ commandes: c.length, commandes_nouvelles: c.filter((x) => x.statut === 'nouvelle').length, commandes_actives: c.filter((x) => x.statut === 'active').length, revenu_mensuel_usd: c.filter((x) => x.statut === 'active').reduce((s, x) => s + x.prix_usd, 0), messages: m.length, messages_nouveaux: m.filter((x) => x.statut === 'nouveau').length, devis: d.length, devis_nouveaux: d.filter((x) => x.statut === 'nouveau').length, devis_acceptes_usd: d.filter((x) => x.statut === 'accepte').reduce((s, x) => s + (x.montant_usd || 0), 0) }]);
      }
      const tab = tables[t]; if (!tab) return send(404, {});
      if (req.method === 'POST') {
        const id = tab.length + 1;
        const ligne = { id, cree_le: new Date().toISOString(), statut: t === 'commandes' ? 'nouvelle' : 'nouveau', reference: refDe(t, id), ...JSON.parse(b) };
        tab.push(ligne); return send(201, [ligne]);
      }
      const idf = u.searchParams.get('id');
      const cible = idf ? tab.filter((x) => `eq.${x.id}` === idf) : [...tab].reverse();
      if (req.method === 'GET') return send(200, cible);
      if (req.method === 'PATCH') { cible.forEach((x) => Object.assign(x, JSON.parse(b))); return send(200, cible); }
      send(405, {});
    });
  });
  await new Promise((r) => fauxSupabase.listen(0, r));
  urlSupabase = `http://127.0.0.1:${fauxSupabase.address().port}`;
  Object.assign(process.env, { SUPABASE_URL: urlSupabase, SUPABASE_SERVICE_ROLE_KEY: 'cle-service', ADMIN_TOKEN: 'jeton-vercel', LIMITE_ENVOIS: '20' });
  delete process.env.SMTP_PASS;
});
after(() => new Promise((r) => fauxSupabase.close(r)));

// ---- simulateur minimal de req/res Vercel ----
function appel(handler, { method = 'GET', url, body, headers = {} }) {
  const u = new URL(url, 'http://x');
  const route = u.pathname.replace(/^\/api\/?/, '');
  const req = { method, url: `/api/index?route=${route}`, query: { route }, headers: { 'x-forwarded-for': '10.0.0.1', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body };
  return new Promise((resolve) => {
    const h = {}; let code = 200;
    const res = {
      setHeader: (k, v) => (h[k.toLowerCase()] = v),
      status(c) { code = c; return this; },
      json(d) { resolve({ status: code, data: d, headers: h }); },
      end() { resolve({ status: code, data: null, headers: h }); },
    };
    handler(req, res);
  });
}

test('chemin Vercel : devis, commande, contact, admin via Supabase', async () => {
  delete require.cache[require.resolve('../../api/index.js')];
  const handler = require('../../api/index.js');

  const s = await appel(handler, { url: '/api/sante' });
  assert.equal(s.data.stockage, 'supabase');

  const d = await appel(handler, { method: 'POST', url: '/api/devis', body: { type_client: 'entreprise', service: 'iot', description: 'Supervision de 4 pompes avec alertes.', nom: 'Rose K.', email: 'rose@ex.cd', telephone: '+243 810 000 000', entreprise: 'Pompes SARL' } });
  assert.equal(d.status, 201);
  assert.equal(d.data.reference, `DEV-${new Date().getUTCFullYear()}-0001`);
  assert.equal(tables.devis[0].type_client, 'entreprise');
  assert.equal(tables.devis[0].budget, null);

  const c = await appel(handler, { method: 'POST', url: '/api/commandes', body: { offre: 'pro', duree_mois: 12, nom: 'Ali B.', email: 'ali@ex.cd', telephone: '0990000000' } });
  assert.equal(c.status, 201);
  assert.equal(c.data.total_usd, 720);
  assert.match(c.data.reference, /^MST-/);

  const m = await appel(handler, { method: 'POST', url: '/api/contact', body: { nom: 'Zoé', email: 'zoe@ex.cd', message: 'Bonjour, une question sur vos services.' } });
  assert.equal(m.status, 201);

  const bad = await appel(handler, { method: 'POST', url: '/api/devis', body: { type_client: 'x' } });
  assert.equal(bad.status, 400);

  assert.equal((await appel(handler, { url: '/api/admin/devis' })).status, 401);
  const A = { authorization: 'Bearer jeton-vercel' };
  const liste = await appel(handler, { url: '/api/admin/devis', headers: A });
  assert.equal(liste.data.devis.length, 1);
  const p = await appel(handler, { method: 'PATCH', url: '/api/admin/devis/1', headers: A, body: { statut: 'accepte', montant_usd: 3200 } });
  assert.equal(p.data.statut, 'accepte');
  assert.equal(p.data.montant_usd, 3200);
  await appel(handler, { method: 'PATCH', url: '/api/admin/commandes/1', headers: A, body: { statut: 'active' } });
  const st = await appel(handler, { url: '/api/admin/stats', headers: A });
  assert.equal(st.data.devis_acceptes_usd, 3200);
  assert.equal(st.data.revenu_mensuel_usd, 60);
  const msg = await appel(handler, { method: 'PATCH', url: '/api/admin/messages/1', headers: A, body: { statut: 'traite' } });
  assert.equal(msg.status, 200);

  assert.equal((await appel(handler, { url: '/api/inconnu' })).status, 404);
  assert.equal((await appel(handler, { method: 'POST', url: '/api/contact', body: undefined, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.ok(vus.every((v) => v.key === 'cle-service' && v.auth === 'Bearer cle-service'));
});

test('chemin Vercel : 503 clair si Supabase non configuré', async () => {
  const sauve = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  delete require.cache[require.resolve('../../api/index.js')];
  const handler = require('../../api/index.js');
  const r = await appel(handler, { url: '/api/sante' });
  assert.equal(r.status, 503);
  process.env.SUPABASE_URL = sauve;
});
