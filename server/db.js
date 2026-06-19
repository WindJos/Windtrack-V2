/* ============================================================
   WindTrack — server/db.js
   Couche d'accès SQLite — CdC §3.3 & §7.3
   - Schéma relationnel équivalent à IndexedDB
   - Mode WAL pour tolérer les écritures concurrentes
   - Déduplication via local_uid (CdC §7.3 & §7.4c)
   ============================================================ */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

/* ── Chemin de la base SQLite ─────────────────────────────── */
/* Stocké dans le même répertoire que ce fichier pour Termux.  */
const DB_PATH = path.join(__dirname, 'windtrack.sqlite');

/** Instance unique de la connexion SQLite. */
let db;

/**
 * Ouvre (ou crée) la base SQLite et initialise le schéma.
 * Mode WAL activé pour les accès concurrents (CdC §3.3).
 * @returns {Database}
 */
function ouvrirDB() {
  if (db) return db;

  db = new Database(DB_PATH);

  /* Mode journal WAL — meilleure concurrence (CdC §3.3) */
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  /* ── Création des tables ── */
  db.exec(`
    /* Table categories — équivalent du store IndexedDB (CdC §3.1) */
    CREATE TABLE IF NOT EXISTS categories (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      nom     TEXT    NOT NULL,
      type    TEXT    NOT NULL CHECK(type IN ('Entrée','Sortie')),
      secteur TEXT    NOT NULL,
      emoji   TEXT,
      custom  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_cat_type    ON categories(type);
    CREATE INDEX IF NOT EXISTS idx_cat_secteur ON categories(secteur);

    /* Table transactions — équivalent du store IndexedDB (CdC §3.1 & §3.3) */
    /* local_uid : identifiant client pour déduplication Solo → Réseau (CdC §7.4c) */
    CREATE TABLE IF NOT EXISTS transactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      montant     REAL    NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      description TEXT,
      date        TEXT    NOT NULL,
      createdAt   TEXT    NOT NULL,
      local_uid   TEXT    UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_tx_cat      ON transactions(category_id);

    /* Table config — clé/valeur JSON sérialisé (CdC §3.3) */
    CREATE TABLE IF NOT EXISTS config (
      cle    TEXT PRIMARY KEY,
      valeur TEXT NOT NULL
    );
  `);

  /* Seed des catégories par défaut si la table est vide (CdC §3.2) */
  seedCategories();

  console.log('[DB] Base SQLite ouverte :', DB_PATH);
  return db;
}

/**
 * Injecte les catégories par défaut si la table est vide (CdC §3.2).
 * Identique au seed IndexedDB côté client.
 */
function seedCategories() {
  const count = db.prepare('SELECT COUNT(*) as n FROM categories').get().n;
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO categories (nom, type, secteur, emoji, custom)
    VALUES (@nom, @type, @secteur, @emoji, @custom)
  `);

  const defaut = [
    { nom: 'Boostage Facebook',       type: 'Entrée', secteur: 'Professionnel', emoji: '🚀', custom: 0 },
    { nom: 'Graphisme & Conception',  type: 'Entrée', secteur: 'Professionnel', emoji: '🎨', custom: 0 },
    { nom: 'Imprimerie',              type: 'Entrée', secteur: 'Professionnel', emoji: '🖨️', custom: 0 },
    { nom: 'Vente de Licences',       type: 'Entrée', secteur: 'Professionnel', emoji: '🔑', custom: 0 },
    { nom: 'Connexion Internet',      type: 'Sortie', secteur: 'Professionnel', emoji: '📡', custom: 0 },
    { nom: 'Matériel de travail',     type: 'Sortie', secteur: 'Professionnel', emoji: '🖥️', custom: 0 },
    { nom: 'Location espace / Cyber', type: 'Sortie', secteur: 'Professionnel', emoji: '🏢', custom: 0 },
    { nom: 'Formations',              type: 'Sortie', secteur: 'Académique',    emoji: '📚', custom: 0 },
    { nom: 'Frais de scolarité',      type: 'Sortie', secteur: 'Académique',    emoji: '🎓', custom: 0 },
    { nom: 'Carburant',               type: 'Sortie', secteur: 'Personnel',     emoji: '⛽', custom: 0 },
    { nom: 'Nourriture / Restau',     type: 'Sortie', secteur: 'Personnel',     emoji: '🍽️', custom: 0 },
    { nom: 'Divers quotidien',        type: 'Sortie', secteur: 'Personnel',     emoji: '🛒', custom: 0 },
  ];

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  insertMany(defaut);
  console.log('[DB] Catégories par défaut insérées.');
}

/* ══════════════════════════════════════════════════════════
   CATEGORIES — CRUD
══════════════════════════════════════════════════════════ */

/** Retourne toutes les catégories. */
function getAllCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY id').all()
    .map(c => ({ ...c, custom: Boolean(c.custom) }));
}

/**
 * Crée une nouvelle catégorie.
 * @param {{nom,type,secteur,emoji,custom}} data
 * @returns {object} catégorie créée avec son id
 */
function createCategorie(data) {
  const stmt = db.prepare(`
    INSERT INTO categories (nom, type, secteur, emoji, custom)
    VALUES (@nom, @type, @secteur, @emoji, @custom)
  `);
  const result = stmt.run({
    nom:     data.nom,
    type:    data.type,
    secteur: data.secteur,
    emoji:   data.emoji   || '📌',
    custom:  data.custom  ? 1 : 0,
  });
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * Supprime une catégorie par son id.
 * @param {number} id
 * @returns {boolean} true si une ligne a été supprimée
 */
function deleteCategorie(id) {
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return result.changes > 0;
}

/* ══════════════════════════════════════════════════════════
   TRANSACTIONS — CRUD
══════════════════════════════════════════════════════════ */

/** Retourne toutes les transactions, triées par date décroissante (CdC §7.5). */
function getAllTransactions() {
  return db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all();
}

/**
 * Crée une transaction avec déduplication via local_uid (CdC §7.4c).
 * Si un local_uid déjà existant est fourni → retourne l'enregistrement existant
 * sans créer de doublon (ON CONFLICT DO NOTHING).
 * @param {{montant,category_id,description,date,createdAt,local_uid}} data
 * @returns {object} transaction (nouvelle ou existante)
 */
function createTransaction(data) {
  /* Vérification préalable si local_uid fourni (CdC §7.4c) */
  if (data.local_uid) {
    const existing = db.prepare(
      'SELECT * FROM transactions WHERE local_uid = ?'
    ).get(data.local_uid);
    if (existing) return existing; // Doublon détecté → retourne l'existant
  }

  const stmt = db.prepare(`
    INSERT INTO transactions (montant, category_id, description, date, createdAt, local_uid)
    VALUES (@montant, @category_id, @description, @date, @createdAt, @local_uid)
  `);

  const result = stmt.run({
    montant:     data.montant,
    category_id: data.category_id,
    description: data.description || null,
    date:        data.date,
    createdAt:   data.createdAt   || new Date().toISOString(),
    local_uid:   data.local_uid   || null,
  });

  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * Supprime une transaction par son id.
 * @param {number} id
 * @returns {boolean}
 */
function deleteTransaction(id) {
  const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  return result.changes > 0;
}

/* ══════════════════════════════════════════════════════════
   CONFIG — clé/valeur JSON
══════════════════════════════════════════════════════════ */

/** Retourne toute la configuration sous forme de tableau [{cle, valeur}]. */
function getAllConfig() {
  return db.prepare('SELECT * FROM config').all().map(row => ({
    cle:    row.cle,
    valeur: JSON.parse(row.valeur),
  }));
}

/**
 * Met à jour (ou crée) une entrée de configuration.
 * @param {string} cle
 * @param {any}    valeur — sera sérialisé en JSON
 */
function upsertConfig(cle, valeur) {
  db.prepare(`
    INSERT INTO config (cle, valeur) VALUES (?, ?)
    ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur
  `).run(cle, JSON.stringify(valeur));
}

module.exports = {
  ouvrirDB,
  getAllCategories,
  createCategorie,
  deleteCategorie,
  getAllTransactions,
  createTransaction,
  deleteTransaction,
  getAllConfig,
  upsertConfig,
};
