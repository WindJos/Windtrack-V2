/* ============================================================
   WindTrack — server/server.js  v1.0.0
   Serveur Express — Mode réseau local multi-appareils (CdC §7)

   Endpoints exposés (CdC §7.5) :
     GET    /api/categories
     POST   /api/categories
     DELETE /api/categories/:id
     GET    /api/transactions
     POST   /api/transactions
     DELETE /api/transactions/:id
     GET    /api/config
     PUT    /api/config/:cle
     GET    /api/events          ← flux SSE temps réel
     GET    /api/status

   Usage Termux :
     pkg install nodejs
     npm install
     node server.js
   ============================================================ */

'use strict';

const express = require('express');
const cors    = require('cors');
const os      = require('os');
const path    = require('path');
const db      = require('./db');

/* ── Configuration ─────────────────────────────────────────── */
const PORT       = process.env.PORT || 3000;
const app        = express();

/* ── Initialisation de la base SQLite ─────────────────────── */
db.ouvrirDB();

/* ── Middlewares ───────────────────────────────────────────── */

/* CORS : autorise tous les appareils du réseau local */
app.use(cors({ origin: '*' }));

/* Parse JSON */
app.use(express.json());

/* Sert les fichiers statiques de l'application (index.html, app.js…)
   depuis le dossier parent — les clients accèdent à l'app via ce serveur */
app.use(express.static(path.join(__dirname, '..')));

/* ══════════════════════════════════════════════════════════
   SERVER-SENT EVENTS (SSE) — CdC §7.3 & §7.5
   Notifie tous les clients connectés à chaque modification.
══════════════════════════════════════════════════════════ */

/** Set des clients SSE actuellement connectés. */
const sseClients = new Set();

/**
 * Pousse un événement SSE à tous les clients connectés.
 * @param {'transaction_created'|'transaction_deleted'|'category_created'|'category_deleted'|'config_updated'} type
 * @param {any} payload — données à envoyer (sérialisées en JSON)
 */
function broadcast(type, payload) {
  const data = JSON.stringify({ type, payload, ts: Date.now() });
  for (const res of sseClients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

/**
 * GET /api/events — Flux SSE (CdC §7.5)
 * Chaque client établit une connexion longue durée.
 * Le serveur pousse un événement à chaque modification de données.
 */
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx proxy

  /* Ping initial pour confirmer la connexion */
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  sseClients.add(res);
  console.log(`[SSE] Client connecté (total: ${sseClients.size})`);

  /* Nettoyage à la déconnexion */
  req.on('close', () => {
    sseClients.delete(res);
    console.log(`[SSE] Client déconnecté (total: ${sseClients.size})`);
  });

  /* Keep-alive toutes les 25 secondes (évite timeout proxy/Android) */
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => clearInterval(keepAlive));
});

/* ══════════════════════════════════════════════════════════
   GET /api/status — État du serveur (CdC §7.5)
══════════════════════════════════════════════════════════ */
app.get('/api/status', (req, res) => {
  res.json({
    ok:              true,
    version:         '1.0.0',
    ip:              getLocalIP(),
    port:            PORT,
    clients_sse:     sseClients.size,
    uptime_seconds:  Math.floor(process.uptime()),
    timestamp:       new Date().toISOString(),
  });
});

/* ══════════════════════════════════════════════════════════
   CATEGORIES (CdC §7.5)
══════════════════════════════════════════════════════════ */

/** GET /api/categories — Liste toutes les catégories */
app.get('/api/categories', (req, res) => {
  try {
    res.json(db.getAllCategories());
  } catch (err) {
    console.error('[API] GET /categories :', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/categories — Crée une catégorie */
app.post('/api/categories', (req, res) => {
  try {
    const { nom, type, secteur, emoji, custom } = req.body;
    if (!nom || !type || !secteur) {
      return res.status(400).json({ error: 'nom, type et secteur sont requis' });
    }
    const cat = db.createCategorie({ nom, type, secteur, emoji, custom });
    broadcast('category_created', cat);
    res.status(201).json(cat);
  } catch (err) {
    console.error('[API] POST /categories :', err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/categories/:id — Supprime une catégorie */
app.delete('/api/categories/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!db.deleteCategorie(id)) {
      return res.status(404).json({ error: 'Catégorie introuvable' });
    }
    broadcast('category_deleted', { id });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[API] DELETE /categories/:id :', err);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   TRANSACTIONS (CdC §7.5)
══════════════════════════════════════════════════════════ */

/** GET /api/transactions — Toutes les transactions (date DESC) */
app.get('/api/transactions', (req, res) => {
  try {
    res.json(db.getAllTransactions());
  } catch (err) {
    console.error('[API] GET /transactions :', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/transactions — Crée une transaction.
 * Gère la déduplication via local_uid (CdC §7.4c) :
 * si local_uid existe déjà → retourne l'existant (200) sans doublon.
 */
app.post('/api/transactions', (req, res) => {
  try {
    const { montant, category_id, description, date, createdAt, local_uid } = req.body;

    if (!montant || !category_id || !date) {
      return res.status(400).json({ error: 'montant, category_id et date sont requis' });
    }

    const tx = db.createTransaction({
      montant:     parseFloat(montant),
      category_id: parseInt(category_id),
      description: description || null,
      date,
      createdAt:   createdAt || new Date().toISOString(),
      local_uid:   local_uid || null,
    });

    /* Broadcast uniquement si la transaction est vraiment nouvelle
       (pas un doublon retourné par déduplication) */
    if (!local_uid || tx.local_uid === local_uid) {
      broadcast('transaction_created', tx);
    }

    res.status(201).json(tx);
  } catch (err) {
    console.error('[API] POST /transactions :', err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/transactions/:id — Supprime une transaction */
app.delete('/api/transactions/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!db.deleteTransaction(id)) {
      return res.status(404).json({ error: 'Transaction introuvable' });
    }
    broadcast('transaction_deleted', { id });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[API] DELETE /transactions/:id :', err);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   CONFIG (CdC §7.5)
══════════════════════════════════════════════════════════ */

/** GET /api/config — Retourne toute la configuration */
app.get('/api/config', (req, res) => {
  try {
    res.json(db.getAllConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/config/:cle — Met à jour une entrée de configuration */
app.put('/api/config/:cle', (req, res) => {
  try {
    const { cle } = req.params;
    const { valeur } = req.body;
    if (valeur === undefined) {
      return res.status(400).json({ error: 'valeur est requise' });
    }
    db.upsertConfig(cle, valeur);
    broadcast('config_updated', { cle, valeur });
    res.json({ ok: true, cle, valeur });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   HELPER — Adresse IP locale
══════════════════════════════════════════════════════════ */

/**
 * Retourne la première adresse IPv4 non-loopback de l'appareil.
 * Sur Termux, c'est l'IP Wi-Fi que les autres appareils utilisent.
 * @returns {string}
 */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/* ══════════════════════════════════════════════════════════
   DÉMARRAGE
══════════════════════════════════════════════════════════ */

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║          WindTrack Serveur v1.0.0            ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Serveur démarré sur le port : ${PORT}           ║`);
  console.log(`║                                              ║`);
  console.log(`║  Accès depuis ce téléphone :                 ║`);
  console.log(`║  ➤  http://localhost:${PORT}               ║`);
  console.log(`║                                              ║`);
  console.log(`║  Accès depuis les autres appareils Wi-Fi :   ║`);
  console.log(`║  ➤  http://${ip}:${PORT}              ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('[Serveur] Base SQLite :', path.join(__dirname, 'windtrack.sqlite'));
  console.log('[Serveur] En attente de connexions…');
});

/* Gestion propre de l'arrêt (Ctrl+C dans Termux) */
process.on('SIGINT',  () => { console.log('\n[Serveur] Arrêt propre.'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[Serveur] Arrêt propre.'); process.exit(0); });
