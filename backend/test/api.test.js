'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { creerApp, config } = require('../server');

let srv, base;
const mails = [];

before(async () => {
  const cfg = { ...config({}), dbPath: ':memory:', limiteEnvois: 12, adminToken: 'jeton-test-123', siteRoot: path.resolve(__dirname, '..', '..') };
  srv = creerApp(cfg, { envoyerMail: async (m) => { mails.push(m); return { envoye: true }; } });
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => new Promise((r) => srv.close(r)));

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const adm = (url, opt = {}) => fetch(base + url, { ...opt, headers: { Authorization: 'Bearer jeton-test-123', 'Content-Type': 'application/json', ...(opt.headers || {}) } });

test('santé et offres', async () => {
  assert.equal((await fetch(base + '/api/sante')).status, 200);
  const o = await (await fetch(base + '/api/offres')).json();
  assert.deepEqual(o.offres.map((x) => x.id), ['starter', 'business', 'pro', 'enterprise']);
});

test('contact valide : enregistré et notifié', async () => {
  const r = await post('/api/contact', { nom: 'Jean K.', email: 'jean@example.com', message: 'Bonjour, je veux un devis pour un projet IoT.' });
  assert.equal(r.status, 201);
  assert.ok(mails.some((m) => m.to === 'mstechniker96@gmail.com' && m.replyTo === 'jean@example.com'));
});

test('contact invalide : 400 avec champs', async () => {
  const r = await post('/api/contact', { nom: 'J', email: 'pas-un-email', message: 'court' });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.ok(j.champs.nom && j.champs.email && j.champs.message);
});

test('pot de miel : accepté mais non enregistré', async () => {
  const r = await post('/api/contact', { nom: 'Robot', email: 'r@x.io', message: 'spam spam spam spam', site_web: 'http://spam' });
  assert.equal(r.status, 201);
  const l = await (await adm('/api/admin/messages')).json();
  assert.ok(!l.messages.some((m) => m.nom === 'Robot'));
});

test('commande valide : référence, total, deux e-mails', async () => {
  const avant = mails.length;
  const r = await post('/api/commandes', { offre: 'business', duree_mois: 3, nom: 'Awa M.', email: 'awa@example.com', telephone: '+243 900 000 000', usage: 'Site e-commerce' });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.match(j.reference, /^MST-\d{4}-\d{4}$/);
  assert.equal(j.total_usd, 90);
  assert.equal(mails.length - avant, 2);
});

test('commande invalide : offre et durée refusées', async () => {
  const r = await post('/api/commandes', { offre: 'gratuit', duree_mois: 5, nom: 'X Y', email: 'x@y.cd', telephone: '0990000000' });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.ok(j.champs.offre && j.champs.duree_mois);
});

test('admin : 401 sans jeton, liste et mise à jour avec jeton', async () => {
  assert.equal((await fetch(base + '/api/admin/commandes')).status, 401);
  assert.equal((await fetch(base + '/api/admin/commandes', { headers: { Authorization: 'Bearer mauvais' } })).status, 401);
  const l = await (await adm('/api/admin/commandes')).json();
  assert.equal(l.commandes.length, 1);
  const id = l.commandes[0].id;
  const p = await adm(`/api/admin/commandes/${id}`, { method: 'PATCH', body: JSON.stringify({ statut: 'active', note_interne: 'Payé' }) });
  assert.equal(p.status, 200);
  assert.equal((await p.json()).statut, 'active');
  const s = await (await adm('/api/admin/stats')).json();
  assert.equal(s.commandes_actives, 1);
  assert.equal(s.revenu_mensuel_usd, 30);
  assert.equal((await adm(`/api/admin/commandes/${id}`, { method: 'PATCH', body: JSON.stringify({ statut: 'nimporte' }) })).status, 400);
});

test('devis entreprise : référence DEV, e-mails, champs entreprise gardés', async () => {
  const avant = mails.length;
  const r = await post('/api/devis', { type_client: 'entreprise', service: 'energie', description: 'Étude d\'une micro-centrale pour un site de 40 foyers.', budget: '2 000 – 10 000 $', delai: '1 à 3 mois', localisation: 'Kwilu', nom: 'Marie T.', fonction: 'Directrice', email: 'marie@coop.cd', telephone: '+243 820 000 000', entreprise: 'Coop Énergie', secteur: 'Agriculture', taille: '11 à 50' });
  assert.equal(r.status, 201);
  assert.match((await r.json()).reference, /^DEV-\d{4}-0001$/);
  assert.equal(mails.length - avant, 2);
  assert.match(mails[mails.length - 2].text, /Coop Énergie/);
});

test('devis particulier : champs entreprise ignorés ; erreurs signalées', async () => {
  const ok = await post('/api/devis', { type_client: 'particulier', service: 'web', description: 'Je veux un site pour mon atelier de couture.', nom: 'Paul N.', email: 'paul@example.com', telephone: '0990000000', entreprise: 'ne doit pas rester' });
  assert.equal(ok.status, 201);
  const bad = await post('/api/devis', { type_client: 'entreprise', service: 'inconnu', description: 'court', nom: 'A', email: 'x', telephone: '' });
  assert.equal(bad.status, 400);
  const j = await bad.json();
  for (const k of ['service', 'description', 'nom', 'email', 'telephone', 'entreprise']) assert.ok(j.champs[k], k);
  const l = await (await adm('/api/admin/devis')).json();
  assert.equal(l.devis.length, 2);
  assert.equal(l.devis[0].entreprise, null);
  const p = await adm(`/api/admin/devis/${l.devis[1].id}`, { method: 'PATCH', body: JSON.stringify({ statut: 'accepte', montant_usd: 4500 }) });
  assert.equal((await p.json()).montant_usd, 4500);
  const s = await (await adm('/api/admin/stats')).json();
  assert.equal(s.devis, 2);
  assert.equal(s.devis_acceptes_usd, 4500);
});

test('site statique servi, fichiers sensibles bloqués', async () => {
  const i = await fetch(base + '/');
  assert.equal(i.status, 200);
  assert.match(await i.text(), /MS Techniker/);
  assert.equal((await fetch(base + '/admin')).status, 200);
  assert.equal((await fetch(base + '/backend/server.js')).status, 404);
  assert.equal((await fetch(base + '/api/_lib/core.js')).status, 404);
  assert.equal((await fetch(base + '/supabase/schema.sql')).status, 404);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
});

test('limite anti-abus : 429 une fois la limite atteinte', async () => {
  let dernier;
  for (let i = 0; i < 13; i++) dernier = await post('/api/contact', { nom: 'Test', email: 't@t.cd', message: 'message de test numéro ' + i });
  assert.equal(dernier.status, 429);
});
