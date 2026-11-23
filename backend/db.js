'use strict';
// Base SQLite intégrée à Node.js 22 (module node:sqlite), aucune dépendance à installer.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const STATUTS_COMMANDE = ['nouvelle', 'en_cours', 'active', 'annulee'];
const STATUTS_MESSAGE = ['nouveau', 'traite'];
const STATUTS_DEVIS = ['nouveau', 'en_etude', 'envoye', 'accepte', 'refuse'];

function ouvrir(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      nom TEXT NOT NULL,
      email TEXT NOT NULL,
      telephone TEXT,
      sujet TEXT,
      message TEXT NOT NULL,
      statut TEXT NOT NULL DEFAULT 'nouveau'
    );
    CREATE TABLE IF NOT EXISTS commandes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT UNIQUE,
      cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      offre TEXT NOT NULL,
      prix_usd INTEGER NOT NULL,
      duree_mois INTEGER NOT NULL DEFAULT 1,
      nom TEXT NOT NULL,
      entreprise TEXT,
      email TEXT NOT NULL,
      telephone TEXT NOT NULL,
      usage TEXT,
      statut TEXT NOT NULL DEFAULT 'nouvelle',
      note_interne TEXT
    );
    CREATE TABLE IF NOT EXISTS devis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT UNIQUE,
      cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      type_client TEXT NOT NULL,
      service TEXT NOT NULL,
      description TEXT NOT NULL,
      budget TEXT,
      delai TEXT,
      localisation TEXT,
      nom TEXT NOT NULL,
      email TEXT NOT NULL,
      telephone TEXT NOT NULL,
      entreprise TEXT,
      secteur TEXT,
      taille TEXT,
      fonction TEXT,
      statut TEXT NOT NULL DEFAULT 'nouveau',
      montant_usd INTEGER,
      note_interne TEXT
    );
  `);

  const st = {
    ajouterMessage: db.prepare('INSERT INTO messages (nom, email, telephone, sujet, message) VALUES (?, ?, ?, ?, ?)'),
    ajouterCommande: db.prepare('INSERT INTO commandes (offre, prix_usd, duree_mois, nom, entreprise, email, telephone, usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    fixerReference: db.prepare('UPDATE commandes SET reference = ? WHERE id = ?'),
    commandes: db.prepare('SELECT * FROM commandes ORDER BY id DESC LIMIT ?'),
    messages: db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?'),
    majCommande: db.prepare('UPDATE commandes SET statut = COALESCE(?, statut), note_interne = COALESCE(?, note_interne) WHERE id = ?'),
    majMessage: db.prepare('UPDATE messages SET statut = ? WHERE id = ?'),
    commande: db.prepare('SELECT * FROM commandes WHERE id = ?'),
    ajouterDevis: db.prepare('INSERT INTO devis (type_client, service, description, budget, delai, localisation, nom, email, telephone, entreprise, secteur, taille, fonction) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    fixerRefDevis: db.prepare('UPDATE devis SET reference = ? WHERE id = ?'),
    devisListe: db.prepare('SELECT * FROM devis ORDER BY id DESC LIMIT ?'),
    majDevis: db.prepare('UPDATE devis SET statut = COALESCE(?, statut), montant_usd = COALESCE(?, montant_usd), note_interne = COALESCE(?, note_interne) WHERE id = ?'),
    unDevis: db.prepare('SELECT * FROM devis WHERE id = ?'),
    stats: db.prepare(`SELECT
      (SELECT COUNT(*) FROM commandes) AS commandes,
      (SELECT COUNT(*) FROM commandes WHERE statut = 'nouvelle') AS commandes_nouvelles,
      (SELECT COUNT(*) FROM commandes WHERE statut = 'active') AS commandes_actives,
      (SELECT COALESCE(SUM(prix_usd), 0) FROM commandes WHERE statut = 'active') AS revenu_mensuel_usd,
      (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(*) FROM messages WHERE statut = 'nouveau') AS messages_nouveaux,
      (SELECT COUNT(*) FROM devis) AS devis,
      (SELECT COUNT(*) FROM devis WHERE statut = 'nouveau') AS devis_nouveaux,
      (SELECT COALESCE(SUM(montant_usd), 0) FROM devis WHERE statut = 'accepte') AS devis_acceptes_usd`),
  };

  return {
    db,
    ajouterMessage(m) {
      const r = st.ajouterMessage.run(m.nom, m.email, m.telephone || null, m.sujet || null, m.message);
      return Number(r.lastInsertRowid);
    },
    ajouterCommande(c) {
      const r = st.ajouterCommande.run(c.offre, c.prixUsd, c.dureeMois, c.nom, c.entreprise || null, c.email, c.telephone, c.usage || null);
      const id = Number(r.lastInsertRowid);
      const reference = `MST-${new Date().getUTCFullYear()}-${String(id).padStart(4, '0')}`;
      st.fixerReference.run(reference, id);
      return { id, reference };
    },
    listerCommandes: (limite = 500) => st.commandes.all(limite),
    listerMessages: (limite = 500) => st.messages.all(limite),
    majCommande(id, { statut, note }) {
      st.majCommande.run(statut ?? null, note ?? null, id);
      return st.commande.get(id) || null;
    },
    majMessage(id, statut) {
      return st.majMessage.run(statut, id).changes > 0;
    },
    ajouterDevis(d) {
      const r = st.ajouterDevis.run(d.typeClient, d.service, d.description, d.budget || null, d.delai || null, d.localisation || null,
        d.nom, d.email, d.telephone, d.entreprise || null, d.secteur || null, d.taille || null, d.fonction || null);
      const id = Number(r.lastInsertRowid);
      const reference = `DEV-${new Date().getUTCFullYear()}-${String(id).padStart(4, '0')}`;
      st.fixerRefDevis.run(reference, id);
      return { id, reference };
    },
    listerDevis: (limite = 500) => st.devisListe.all(limite),
    majDevis(id, { statut, montant, note }) {
      st.majDevis.run(statut ?? null, montant ?? null, note ?? null, id);
      return st.unDevis.get(id) || null;
    },
    stats: () => st.stats.get(),
    fermer: () => db.close(),
  };
}

module.exports = { ouvrir, STATUTS_COMMANDE, STATUTS_MESSAGE, STATUTS_DEVIS };
