'use strict';
// Base SQLite intégrée à Node.js 22 (module node:sqlite), aucune dépendance à installer.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const STATUTS_COMMANDE = ['nouvelle', 'en_cours', 'active', 'annulee'];
const STATUTS_MESSAGE = ['nouveau', 'traite'];

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
    stats: db.prepare(`SELECT
      (SELECT COUNT(*) FROM commandes) AS commandes,
      (SELECT COUNT(*) FROM commandes WHERE statut = 'nouvelle') AS commandes_nouvelles,
      (SELECT COUNT(*) FROM commandes WHERE statut = 'active') AS commandes_actives,
      (SELECT COALESCE(SUM(prix_usd), 0) FROM commandes WHERE statut = 'active') AS revenu_mensuel_usd,
      (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(*) FROM messages WHERE statut = 'nouveau') AS messages_nouveaux`),
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
    stats: () => st.stats.get(),
    fermer: () => db.close(),
  };
}

module.exports = { ouvrir, STATUTS_COMMANDE, STATUTS_MESSAGE };
