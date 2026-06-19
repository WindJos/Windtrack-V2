/* ============================================================
   WindTrack — app.js  v1.0.0
   Conforme au Cahier des Charges Technique & Fonctionnel
   Sections couvertes : §2 (stack) · §3 (IndexedDB) · §4 (SPA)
                        §5 (UI globale) · §6 (design) · §8 (calculs)
   ============================================================ */

'use strict';

/* ══════════════════════════════════════════════════════════
   1. ÉTAT GLOBAL
══════════════════════════════════════════════════════════ */

/** Instance de la base IndexedDB (CdC §3.1) */
let db = null;

/** Écran courant dans la SPA */
let ecranCourant = 'dashboard';

/** Type sélectionné dans le formulaire de saisie : 'Entrée' | 'Sortie' */
let typeCourant = 'Entrée';

/** Période active sur le dashboard : 'mois' | 'semaine' | 'aujourd_hui' | 'tout' */
let periodeActive = 'mois';

/** Période active dans l'historique */
let histPeriode = 'mois';

/** Filtre type dans l'historique : 'all' | 'Entrée' | 'Sortie' */
let histType = 'all';

/**
 * Raccourcis Boostage configurables (CdC §4.2c & §4.5a).
 * Valeurs par défaut — écrasées par la config persistée en IndexedDB.
 */
let raccourcisBoostage = [
  { label: 'Contrat 3j',  montant: 5000,  description: 'Contrat Facebook 3 jours' },
  { label: 'Contrat 7j',  montant: 15000, description: 'Contrat Facebook 7 jours' },
  { label: 'Contrat 14j', montant: 28000, description: 'Contrat Facebook 14 jours' },
];

/* ══════════════════════════════════════════════════════════
   2. INITIALISATION — IndexedDB (CdC §3.1)
══════════════════════════════════════════════════════════ */

/**
 * Ouvre la base windtrack_db (version 1) et crée les trois
 * Object Stores définis dans le CdC §3.1.
 * @returns {Promise<IDBDatabase>}
 */
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('windtrack_db', 1);

    request.onupgradeneeded = (e) => {
      const database = e.target.result;

      /* ── Store : categories ── */
      if (!database.objectStoreNames.contains('categories')) {
        const catStore = database.createObjectStore('categories', {
          keyPath: 'id', autoIncrement: true,
        });
        catStore.createIndex('type',    'type',    { unique: false });
        catStore.createIndex('secteur', 'secteur', { unique: false });
      }

      /* ── Store : transactions ── */
      if (!database.objectStoreNames.contains('transactions')) {
        const txStore = database.createObjectStore('transactions', {
          keyPath: 'id', autoIncrement: true,
        });
        txStore.createIndex('date',        'date',        { unique: false });
        txStore.createIndex('category_id', 'category_id', { unique: false });
      }

      /* ── Store : config (clé-valeur) ── */
      if (!database.objectStoreNames.contains('config')) {
        database.createObjectStore('config', { keyPath: 'cle' });
      }
    };

    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror   = ()  => reject(request.error);
  });
}

/**
 * Injecte les catégories par défaut si le store est vide (CdC §3.2).
 * Les catégories seed ont custom:false et ne sont pas supprimables depuis l'UI.
 */
async function seedCategories() {
  const toutes = await dbGetAll('categories');
  if (toutes.length > 0) return; // Déjà initialisé

  const defaut = [
    /* Entrées — Professionnel */
    { nom: 'Boostage Facebook',      type: 'Entrée', secteur: 'Professionnel', emoji: '🚀', custom: false },
    { nom: 'Graphisme & Conception', type: 'Entrée', secteur: 'Professionnel', emoji: '🎨', custom: false },
    { nom: 'Imprimerie',             type: 'Entrée', secteur: 'Professionnel', emoji: '🖨️', custom: false },
    { nom: 'Vente de Licences',      type: 'Entrée', secteur: 'Professionnel', emoji: '🔑', custom: false },
    /* Sorties — Professionnel */
    { nom: 'Connexion Internet',      type: 'Sortie', secteur: 'Professionnel', emoji: '📡', custom: false },
    { nom: 'Matériel de travail',     type: 'Sortie', secteur: 'Professionnel', emoji: '🖥️', custom: false },
    { nom: "Location espace / Cyber", type: 'Sortie', secteur: 'Professionnel', emoji: '🏢', custom: false },
    /* Sorties — Académique */
    { nom: 'Formations',             type: 'Sortie', secteur: 'Académique',    emoji: '📚', custom: false },
    { nom: 'Frais de scolarité',     type: 'Sortie', secteur: 'Académique',    emoji: '🎓', custom: false },
    /* Sorties — Personnel */
    { nom: 'Carburant',              type: 'Sortie', secteur: 'Personnel',     emoji: '⛽', custom: false },
    { nom: 'Nourriture / Restau',    type: 'Sortie', secteur: 'Personnel',     emoji: '🍽️', custom: false },
    { nom: 'Divers quotidien',       type: 'Sortie', secteur: 'Personnel',     emoji: '🛒', custom: false },
  ];

  for (const cat of defaut) await dbAdd('categories', cat);
}

/**
 * Charge la configuration persistée (thème, raccourcis) au démarrage.
 */
async function chargerConfig() {
  const savedRacc = await dbGet('config', 'raccourcis_boostage');
  if (savedRacc) raccourcisBoostage = savedRacc.valeur;

  const savedTheme = await dbGet('config', 'theme');
  if (savedTheme) appliquerTheme(savedTheme.valeur);
}

/* ══════════════════════════════════════════════════════════
   3. HELPERS INDEXEDDB
══════════════════════════════════════════════════════════ */

/** Ajoute un enregistrement dans le store donné. @returns {Promise<number>} id généré */
function dbAdd(store, data) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Met à jour (ou crée) un enregistrement (put). */
function dbPut(store, data) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Lit un enregistrement par sa clé primaire. @returns {Promise<any|undefined>} */
function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Retourne tous les enregistrements d'un store. @returns {Promise<any[]>} */
function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Supprime un enregistrement par sa clé primaire. */
function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Vide entièrement un store. */
function dbClear(store) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/* ══════════════════════════════════════════════════════════
   4. NAVIGATION SPA (CdC §4 intro)
══════════════════════════════════════════════════════════ */

/** Titres affichés dans le header selon l'écran actif. */
const TITRES = {
  dashboard:  'Tableau de bord',
  saisie:     'Nouveau flux',
  historique: 'Historique',
  graphiques: 'Graphiques',
  parametres: 'Paramètres',
};

/** Index des boutons dans la bottom-nav (dashboard=0, historique=1, graphiques=3, parametres=4). */
const NAV_IDX = { dashboard: 0, historique: 1, graphiques: 3, parametres: 4 };

/**
 * Navigue vers l'écran demandé en masquant les autres.
 * Recharge les données pertinentes (CdC §4 intro — "chaque navigation déclenche le rechargement").
 * @param {string} ecran — Identifiant de l'écran cible
 */
function navigateTo(ecran) {
  /* Masquer tous les écrans */
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  /* Activer l'écran cible */
  const el = document.getElementById(`screen-${ecran}`);
  if (!el) return;
  el.classList.add('active');
  ecranCourant = ecran;

  /* Titre header */
  document.getElementById('header-title').textContent = TITRES[ecran] || '';

  /* Mettre à jour la bottom-nav */
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (NAV_IDX[ecran] !== undefined) {
    document.querySelectorAll('.nav-btn')[NAV_IDX[ecran]]?.classList.add('active');
  }

  /* Remonter en haut */
  el.scrollTop = 0;

  /* Charger les données de l'écran */
  switch (ecran) {
    case 'dashboard':  rafraichirDashboard();  break;
    case 'saisie':     initSaisie();            break;
    case 'historique': rafraichirHistorique();  break;
    case 'graphiques': rafraichirGraphiques();  break;
    case 'parametres': initParametres();        break;
  }
}

/* ══════════════════════════════════════════════════════════
   5. SIDEBAR (CdC §5.2)
══════════════════════════════════════════════════════════ */

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

/* ══════════════════════════════════════════════════════════
   6. THÈME JOUR / NUIT (CdC §6.3)
══════════════════════════════════════════════════════════ */

/**
 * Applique le thème donné en ajoutant/retirant la classe .dark sur <html>.
 * @param {'light'|'dark'} theme
 */
function appliquerTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    document.getElementById('theme-icon').textContent = '☀️';
  } else {
    document.documentElement.classList.remove('dark');
    document.getElementById('theme-icon').textContent = '🌙';
  }
}

/** Bascule le thème et le persiste dans IndexedDB. */
async function toggleTheme() {
  const isDark   = document.documentElement.classList.contains('dark');
  const newTheme = isDark ? 'light' : 'dark';
  appliquerTheme(newTheme);
  await dbPut('config', { cle: 'theme', valeur: newTheme });
}

/* ══════════════════════════════════════════════════════════
   7. FORMATAGE (CdC §8 — montants en FCFA)
══════════════════════════════════════════════════════════ */

/**
 * Formate un nombre en Francs CFA avec séparateurs de milliers.
 * Ex : 15000 → "15 000 F"
 * @param {number} n
 * @returns {string}
 */
function fCFA(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('fr-FR') + ' F';
}

/**
 * Formate une date ISO YYYY-MM-DD en affichage court français.
 * Ex : "2026-06-15" → "15 juin"
 * @param {string} iso
 * @returns {string}
 */
function fDate(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short',
  });
}

/** Retourne la date du jour en format ISO YYYY-MM-DD. */
function dateAujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

/* ══════════════════════════════════════════════════════════
   8. FILTRAGE PAR PÉRIODE (CdC §8.6)
══════════════════════════════════════════════════════════ */

/**
 * Calcule les bornes de date {debut, fin} pour une période donnée.
 * Toutes les comparaisons se font en ISO YYYY-MM-DD (comparaison lexicographique).
 * @param {'mois'|'semaine'|'aujourd_hui'|'tout'} periode
 * @returns {{debut:string, fin:string}}
 */
function getPlageDates(periode) {
  const auj = new Date();
  let debut, fin;

  switch (periode) {
    case 'aujourd_hui':
      debut = dateAujourdhui();
      fin   = dateAujourdhui();
      break;

    case 'semaine': {
      /* Lundi de la semaine courante (CdC §8.6) */
      const jourSem = auj.getDay() || 7; // 0=dim → 7
      const lundi   = new Date(auj);
      lundi.setDate(auj.getDate() - jourSem + 1);
      debut = lundi.toISOString().slice(0, 10);
      fin   = dateAujourdhui();
      break;
    }

    case 'mois':
      debut = `${auj.getFullYear()}-${String(auj.getMonth() + 1).padStart(2, '0')}-01`;
      fin   = dateAujourdhui();
      break;

    case 'tout':
    default:
      debut = '2000-01-01';
      fin   = '2099-12-31';
      break;
  }
  return { debut, fin };
}

/**
 * Filtre un tableau de transactions selon la période.
 * @param {any[]} transactions
 * @param {string} periode
 * @returns {any[]}
 */
function filtrerParPeriode(transactions, periode) {
  const { debut, fin } = getPlageDates(periode);
  return transactions.filter(tx => tx.date >= debut && tx.date <= fin);
}

/* ══════════════════════════════════════════════════════════
   9. DASHBOARD (CdC §4.1)
══════════════════════════════════════════════════════════ */

/**
 * Change la période active sur le dashboard et rafraîchit.
 * @param {string} periode
 * @param {HTMLElement} btn — bouton cliqué (pour gestion de la classe active)
 */
function setPeriod(periode, btn) {
  periodeActive = periode;
  document.querySelectorAll('[data-period]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  rafraichirDashboard();
}

/** Recharge et re-rend tous les blocs du tableau de bord. */
async function rafraichirDashboard() {
  const [toutes, categories] = await Promise.all([
    dbGetAll('transactions'),
    dbGetAll('categories'),
  ]);

  const txPeriode = filtrerParPeriode(toutes, periodeActive);

  /* ── Calcul Solde Net (CdC §8.1) ── */
  const entrees = sommeParType(txPeriode, categories, 'Entrée');
  const sorties = sommeParType(txPeriode, categories, 'Sortie');
  const solde   = entrees - sorties;

  /* b) Carte Solde Net */
  const soldeCard = document.getElementById('solde-card');
  document.getElementById('solde-value').textContent = (solde >= 0 ? '+' : '') + fCFA(solde);
  soldeCard.classList.toggle('negative', solde < 0);

  /* Tendance vs mois précédent (CdC §8.2) */
  const mp             = getMoisPrecedent();
  const txMoisPrec     = toutes.filter(tx => tx.date >= mp.debut && tx.date <= mp.fin);
  const soldePrecedent = calculerSolde(txMoisPrec, categories);
  afficherTendance(solde, soldePrecedent);

  /* c) Totaux */
  document.getElementById('total-entrees').textContent = fCFA(entrees);
  document.getElementById('total-sorties').textContent = fCFA(sorties);

  /* d) Répartition dépenses par secteur (CdC §8.3) */
  const secteurs = ['Professionnel', 'Personnel', 'Académique'];
  const parSect  = {};
  secteurs.forEach(s => { parSect[s] = 0; });

  txPeriode.forEach(tx => {
    const cat = categories.find(c => c.id === tx.category_id);
    if (cat?.type === 'Sortie' && parSect[cat.secteur] !== undefined) {
      parSect[cat.secteur] += tx.montant;
    }
  });

  const totalSorties = Object.values(parSect).reduce((a, b) => a + b, 0) || 1; // éviter /0

  const pcts = {
    Professionnel: Math.round((parSect.Professionnel / totalSorties) * 100),
    Personnel:     Math.round((parSect.Personnel     / totalSorties) * 100),
    Académique:    Math.round((parSect.Académique    / totalSorties) * 100),
  };

  document.getElementById('pct-pro').textContent    = pcts.Professionnel + '%';
  document.getElementById('pct-perso').textContent  = pcts.Personnel     + '%';
  document.getElementById('pct-acad').textContent   = pcts.Académique    + '%';
  document.getElementById('bar-pro').style.width    = pcts.Professionnel + '%';
  document.getElementById('bar-perso').style.width  = pcts.Personnel     + '%';
  document.getElementById('bar-acad').style.width   = pcts.Académique    + '%';

  /* e) Bilan par secteur (CdC §8.4) */
  const EMOJIS_SECT = { Professionnel: '💼', Personnel: '🏠', Académique: '🎓' };
  let bilanHTML = '';

  for (const sect of secteurs) {
    const e = sommeParTypeEtSecteur(txPeriode, categories, 'Entrée', sect);
    const s = sommeParTypeEtSecteur(txPeriode, categories, 'Sortie', sect);
    const b = e - s;
    const c = b >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400';
    bilanHTML += `
      <div class="flex items-center justify-between py-1.5">
        <span class="text-sm text-gray-600 dark:text-gray-300">${EMOJIS_SECT[sect]} ${sect}</span>
        <span class="montant text-sm font-semibold ${c}">${b >= 0 ? '+' : ''}${fCFA(b)}</span>
      </div>`;
  }
  document.getElementById('bilan-secteurs').innerHTML =
    bilanHTML || '<p class="text-sm text-gray-400">Aucune donnée.</p>';

  /* f) 5 dernières transactions */
  const recentes = [...txPeriode]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const recentesEl = document.getElementById('recentes-list');

  if (!recentes.length) {
    recentesEl.innerHTML =
      '<p class="text-sm text-gray-400 text-center py-4">Aucune transaction pour cette période.</p>';
    return;
  }

  recentesEl.innerHTML = recentes.map(tx => renderTxRow(tx, categories, false)).join('');
}

/* ── Helpers calculs (CdC §8) ── */

/**
 * Somme les montants des transactions d'un type donné.
 * @param {any[]} txList @param {any[]} categories @param {'Entrée'|'Sortie'} type
 * @returns {number}
 */
function sommeParType(txList, categories, type) {
  return txList.reduce((s, tx) => {
    const cat = categories.find(c => c.id === tx.category_id);
    return cat?.type === type ? s + tx.montant : s;
  }, 0);
}

/** Somme les montants d'un type ET d'un secteur. */
function sommeParTypeEtSecteur(txList, categories, type, secteur) {
  return txList.reduce((s, tx) => {
    const cat = categories.find(c => c.id === tx.category_id);
    return cat?.type === type && cat?.secteur === secteur ? s + tx.montant : s;
  }, 0);
}

/** Calcule le solde net d'une liste de transactions. */
function calculerSolde(txList, categories) {
  return txList.reduce((s, tx) => {
    const cat = categories.find(c => c.id === tx.category_id);
    return s + (cat?.type === 'Entrée' ? tx.montant : -tx.montant);
  }, 0);
}

/** Retourne {debut, fin} du mois précédent complet (CdC §8.2). */
function getMoisPrecedent() {
  const auj = new Date();
  const mp  = new Date(auj.getFullYear(), auj.getMonth() - 1, 1);
  const dj  = new Date(auj.getFullYear(), auj.getMonth(), 0);
  return {
    debut: mp.toISOString().slice(0, 10),
    fin:   dj.toISOString().slice(0, 10),
  };
}

/**
 * Met à jour le badge de tendance du dashboard (CdC §8.2).
 * @param {number} soldeCourant
 * @param {number} soldePrecedent
 */
function afficherTendance(soldeCourant, soldePrecedent) {
  const iconEl = document.getElementById('tendance-icon');
  const textEl = document.getElementById('tendance-text');

  if (soldePrecedent === 0) {
    iconEl.textContent = '—';
    textEl.textContent = 'vs mois précédent';
    return;
  }

  const diff = soldeCourant - soldePrecedent;
  const pct  = Math.abs(Math.round((diff / Math.abs(soldePrecedent)) * 100));

  if      (diff > 0) iconEl.textContent = `↑ +${pct}%`;
  else if (diff < 0) iconEl.textContent = `↓ −${pct}%`;
  else               iconEl.textContent = '→ stable';
  textEl.textContent = 'vs mois précédent';
}

/**
 * Génère le HTML d'une ligne de transaction.
 * @param {any}     tx          — objet transaction
 * @param {any[]}   categories  — liste complète des catégories
 * @param {boolean} avecSuppr   — afficher le bouton supprimer (long-press)
 * @returns {string}
 */
function renderTxRow(tx, categories, avecSuppr = true) {
  const cat   = categories.find(c => c.id === tx.category_id);
  const isE   = cat?.type === 'Entrée';
  const coul  = isE ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400';
  const signe = isE ? '+' : '−';
  const fond  = isE ? '#DCFCE7' : '#FEE2E2';

  const btnSuppr = avecSuppr
    ? `<button class="del-btn" onclick="supprimerTransaction(${tx.id})" title="Supprimer">🗑</button>`
    : '';

  return `
    <div class="tx-row" id="tx-${tx.id}">
      <div class="cat-badge" style="background:${fond}">${cat?.emoji || (isE ? '↑' : '↓')}</div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">${cat?.nom || '—'}</p>
        ${tx.description ? `<p class="text-xs text-gray-400 truncate">${tx.description}</p>` : ''}
        ${avecSuppr ? `<p class="text-xs text-gray-400">${fDate(tx.date)}</p>` : ''}
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <div class="text-right">
          <p class="montant text-sm font-bold ${coul}">${signe}${fCFA(tx.montant)}</p>
          ${!avecSuppr ? `<p class="text-xs text-gray-400">${fDate(tx.date)}</p>` : ''}
        </div>
        ${btnSuppr}
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   10. FORMULAIRE DE SAISIE (CdC §4.2)
══════════════════════════════════════════════════════════ */

/** Initialise le formulaire de saisie (réinitialise les champs). */
async function initSaisie() {
  document.getElementById('input-montant').value     = '';
  document.getElementById('input-description').value = '';
  document.getElementById('input-date').value        = dateAujourdhui();
  setType('Entrée');
  await chargerCategories();
}

/**
 * Bascule entre le type Entrée et Sortie (CdC §4.2a).
 * Met à jour les styles des boutons et recharge les catégories.
 * @param {'Entrée'|'Sortie'} type
 */
function setType(type) {
  typeCourant = type;
  document.getElementById('btn-entree').className =
    type === 'Entrée' ? 'type-btn active-entree' : 'type-btn';
  document.getElementById('btn-sortie').className =
    type === 'Sortie' ? 'type-btn active-sortie' : 'type-btn';
  chargerCategories();
}

/**
 * Charge les catégories filtrées par le type courant dans le <select> (CdC §4.2d).
 * Chaque option affiche l'emoji + le nom de la catégorie.
 */
async function chargerCategories() {
  const categories = await dbGetAll('categories');
  const filtrees   = categories.filter(c => c.type === typeCourant);
  const select     = document.getElementById('input-categorie');

  select.innerHTML =
    '<option value="">Sélectionner une catégorie…</option>' +
    filtrees.map(c =>
      `<option value="${c.id}">${c.emoji || ''} ${c.nom}</option>`
    ).join('');

  document.getElementById('raccourcis-boostage').classList.add('hidden');
}

/**
 * Détecte si la catégorie sélectionnée est « Boostage Facebook »
 * et affiche/masque les raccourcis en conséquence (CdC §4.2c).
 */
function onCategorieChange() {
  const select = document.getElementById('input-categorie');
  const texte  = select.options[select.selectedIndex]?.text || '';
  if (texte.includes('Boostage Facebook')) {
    afficherRaccourcis();
  } else {
    document.getElementById('raccourcis-boostage').classList.add('hidden');
  }
}

/** Construit et affiche les 3 boutons de raccourcis Boostage. */
function afficherRaccourcis() {
  const list = document.getElementById('raccourcis-list');
  list.innerHTML = raccourcisBoostage.map((r, i) => `
    <button class="raccourci-btn" onclick="appliquerRaccourci(${i})">
      ${r.label} — ${fCFA(r.montant)}
    </button>
  `).join('');
  document.getElementById('raccourcis-boostage').classList.remove('hidden');
}

/**
 * Pré-remplit montant et description depuis un raccourci (CdC §4.2c).
 * @param {number} index
 */
function appliquerRaccourci(index) {
  const r = raccourcisBoostage[index];
  if (!r) return;
  document.getElementById('input-montant').value     = r.montant;
  document.getElementById('input-description').value = r.description;
}

/** Hook disponible pour extensions futures. */
function onMontantChange() {}

/**
 * Valide et enregistre une nouvelle transaction (CdC §4.2g).
 * Affiche un toast d'erreur si la validation échoue.
 * En cas de succès : toast de confirmation + reset + redirect dashboard après 600 ms.
 */
async function enregistrerTransaction() {
  const montant     = parseFloat(document.getElementById('input-montant').value);
  const catId       = parseInt(document.getElementById('input-categorie').value);
  const description = document.getElementById('input-description').value.trim();
  const date        = document.getElementById('input-date').value;

  /* Validations (CdC §4.2g) */
  if (!montant || montant <= 0) { showToast('Saisis un montant valide (> 0)', 'error'); return; }
  if (!catId)                   { showToast('Sélectionne une catégorie', 'error');       return; }
  if (!date)                    { showToast('Sélectionne une date', 'error');             return; }

  try {
    await dbAdd('transactions', {
      montant,
      category_id: catId,
      description: description || null,
      date,
      createdAt:   new Date().toISOString(),
    });

    showToast('Transaction enregistrée ✓', 'success');

    /* Reset formulaire */
    document.getElementById('input-montant').value     = '';
    document.getElementById('input-description').value = '';
    document.getElementById('raccourcis-boostage').classList.add('hidden');

    /* Retour au dashboard après 600 ms (CdC §4.2g) */
    setTimeout(() => navigateTo('dashboard'), 600);

  } catch (err) {
    console.error('[WindTrack] Erreur enregistrement :', err);
    showToast("Erreur lors de l'enregistrement", 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   11. HISTORIQUE (CdC §4.3)
══════════════════════════════════════════════════════════ */

function setHistPeriod(periode, btn) {
  histPeriode = periode;
  document.querySelectorAll('[data-period-hist]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  rafraichirHistorique();
}

function setHistType(type, btn) {
  histType = type;
  document.querySelectorAll('[data-type-hist]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  rafraichirHistorique();
}

/** Recharge la liste de l'historique selon les filtres actifs (CdC §4.3). */
async function rafraichirHistorique() {
  const [toutes, categories] = await Promise.all([
    dbGetAll('transactions'),
    dbGetAll('categories'),
  ]);

  let filtrees = filtrerParPeriode(toutes, histPeriode);

  /* Filtre par type (CdC §4.3a) */
  if (histType !== 'all') {
    filtrees = filtrees.filter(tx => {
      const cat = categories.find(c => c.id === tx.category_id);
      return cat?.type === histType;
    });
  }

  /* Tri chronologique inverse (CdC §4.3b) */
  filtrees.sort((a, b) => b.date.localeCompare(a.date));

  const container = document.getElementById('historique-list');

  if (!filtrees.length) {
    container.innerHTML =
      '<p class="text-sm text-gray-400 text-center py-8">Aucune transaction pour cette période.</p>';
    return;
  }

  container.innerHTML = filtrees
    .map(tx => renderTxRow(tx, categories, true))
    .join('');

  /* Long-press pour révéler le bouton supprimer (CdC §4.3c — ≈500 ms) */
  container.querySelectorAll('.tx-row').forEach(row => {
    let timer;
    row.addEventListener('touchstart', () => {
      timer = setTimeout(() => {
        container.querySelectorAll('.tx-row').forEach(r => r.classList.remove('reveal'));
        row.classList.add('reveal');
      }, 500);
    }, { passive: true });
    row.addEventListener('touchend', () => clearTimeout(timer));
    row.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
  });
}

/**
 * Supprime une transaction après confirmation (CdC §4.3c & §5.5).
 * @param {number} id
 */
async function supprimerTransaction(id) {
  if (!confirm('Supprimer cette transaction ?')) return; // CdC §5.5
  await dbDelete('transactions', id);
  showToast('Transaction supprimée', 'info');
  rafraichirHistorique();
}

/* ══════════════════════════════════════════════════════════
   12. GRAPHIQUES — SVG pur (CdC §4.4)
══════════════════════════════════════════════════════════ */

/** Recharge les 3 blocs de l'écran Graphiques. */
async function rafraichirGraphiques() {
  const [toutes, categories] = await Promise.all([
    dbGetAll('transactions'),
    dbGetAll('categories'),
  ]);
  dessinerGraphique6Mois(toutes, categories);
  afficherStats(toutes, categories);
  afficherTopCategories(toutes, categories);
}

/**
 * Génère un graphique SVG en barres groupées (Entrées vs Sorties) sur 6 mois (CdC §4.4a).
 * Aucune librairie externe — SVG construit dynamiquement en JavaScript.
 */
function dessinerGraphique6Mois(transactions, categories) {
  const mois6     = derniers6Mois();
  const container = document.getElementById('chart-container');
  const W  = container.clientWidth || 300;
  const H  = 160;
  const P  = { top: 10, right: 10, bottom: 28, left: 42 };
  const iW = W - P.left - P.right;
  const iH = H - P.top  - P.bottom;
  const nb = mois6.length;
  const gW = iW / nb;
  const bW = (gW - 12) / 2;

  /* Valeurs par mois */
  const valeurs = mois6.map(m => {
    const txM = transactions.filter(tx => tx.date.startsWith(m.key));
    const ent = txM.filter(tx => categories.find(c => c.id === tx.category_id)?.type === 'Entrée')
                    .reduce((s, t) => s + t.montant, 0);
    const sor = txM.filter(tx => categories.find(c => c.id === tx.category_id)?.type === 'Sortie')
                    .reduce((s, t) => s + t.montant, 0);
    return { ent, sor, label: m.label };
  });

  const maxVal = Math.max(...valeurs.flatMap(v => [v.ent, v.sor]), 1);

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  /* Grille et graduations (CdC §4.4a) */
  [0, 0.25, 0.5, 0.75, 1].forEach(pct => {
    const y = P.top + iH * (1 - pct);
    svg += `<line x1="${P.left}" y1="${y}" x2="${W - P.right}" y2="${y}"
              stroke="#E7E5E4" stroke-width="1" stroke-dasharray="3,3"/>`;
    if (pct > 0) {
      svg += `<text x="${P.left - 4}" y="${y + 4}" text-anchor="end"
                font-size="9" fill="#9CA3AF" font-family="DM Mono,monospace"
              >${fMontantCourt(maxVal * pct)}</text>`;
    }
  });

  /* Barres groupées */
  valeurs.forEach((v, i) => {
    const xG  = P.left + i * gW + 6;
    const hE  = v.ent > 0 ? Math.max((v.ent / maxVal) * iH, 3) : 0;
    const hS  = v.sor > 0 ? Math.max((v.sor / maxVal) * iH, 3) : 0;
    const yE  = P.top + iH - hE;
    const yS  = P.top + iH - hS;

    if (v.ent > 0) svg += `<rect x="${xG}"         y="${yE}" width="${bW}" height="${hE}" rx="3" fill="#22C55E" opacity=".85"/>`;
    if (v.sor > 0) svg += `<rect x="${xG + bW + 4}" y="${yS}" width="${bW}" height="${hS}" rx="3" fill="#EF4444" opacity=".75"/>`;

    /* Étiquette mois */
    const xLbl = xG + gW / 2 - 6;
    svg += `<text x="${xLbl}" y="${H - 4}" text-anchor="middle"
              font-size="9" fill="#9CA3AF" font-family="Inter,sans-serif">${v.label}</text>`;
  });

  svg += '</svg>';
  container.innerHTML = svg;
}

/** Retourne les 6 derniers mois glissants [{key:'YYYY-MM', label:'mois'}]. */
function derniers6Mois() {
  const mois = [];
  const now  = new Date();
  for (let i = 5; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    mois.push({ key, label: d.toLocaleDateString('fr-FR', { month: 'short' }) });
  }
  return mois;
}

/** Formate un grand nombre en notation courte pour les graduations SVG. */
function fMontantCourt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0)     + 'k';
  return String(Math.round(n));
}

/**
 * Affiche le bloc Statistiques (CdC §4.4b & §8.5).
 */
function afficherStats(transactions, categories) {
  const mois6      = derniers6Mois();
  const caParMois  = mois6.map(m => {
    const txM = transactions.filter(tx => tx.date.startsWith(m.key));
    return txM.filter(tx => categories.find(c => c.id === tx.category_id)?.type === 'Entrée')
              .reduce((s, t) => s + t.montant, 0);
  });

  /* Meilleur mois (CdC §8.5) */
  const meilleurIdx = caParMois.indexOf(Math.max(...caParMois));

  /* Moyenne mensuelle (CdC §8.5 — mois sans transaction comptés 0) */
  const moyMois = caParMois.reduce((s, v) => s + v, 0) / 6;

  /* Totaux généraux (toutes périodes) */
  const totalE = sommeParType(transactions, categories, 'Entrée');
  const totalS = sommeParType(transactions, categories, 'Sortie');

  const items = [
    { label: '📅 Meilleur mois',       val: mois6[meilleurIdx]?.label || '—' },
    { label: '🏆 Revenu ce mois-là',   val: fCFA(caParMois[meilleurIdx] || 0) },
    { label: '📊 Moy. mensuelle',       val: fCFA(Math.round(moyMois)) },
    { label: '💳 Nb. transactions',     val: String(transactions.length) },
    { label: '↑ Total entrées',         val: fCFA(totalE) },
    { label: '↓ Total sorties',         val: fCFA(totalS) },
  ];

  document.getElementById('stats-grid').innerHTML = items.map(s => `
    <div class="bg-beige-50 dark:bg-zinc-800 rounded-xl p-3">
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">${s.label}</p>
      <p class="montant text-sm font-bold text-gray-800 dark:text-white">${s.val}</p>
    </div>
  `).join('');
}

/**
 * Affiche le Top 5 des catégories d'entrées (CdC §4.4c).
 */
function afficherTopCategories(transactions, categories) {
  const entrees = transactions.filter(tx =>
    categories.find(c => c.id === tx.category_id)?.type === 'Entrée'
  );

  const parCat = {};
  entrees.forEach(tx => { parCat[tx.category_id] = (parCat[tx.category_id] || 0) + tx.montant; });

  const top    = Object.entries(parCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxVal = top[0]?.[1] || 1;

  const container = document.getElementById('top-categories');
  if (!top.length) {
    container.innerHTML = '<p class="text-sm text-gray-400">Aucune entrée enregistrée.</p>';
    return;
  }

  container.innerHTML = top.map(([catId, total]) => {
    const cat = categories.find(c => c.id === Number(catId));
    const pct = Math.round((total / maxVal) * 100);
    return `
      <div>
        <div class="flex justify-between text-xs text-gray-600 dark:text-gray-300 mb-1.5">
          <span>${cat?.emoji || ''} ${cat?.nom || '—'}</span>
          <span class="montant font-semibold">${fCFA(total)}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill bg-indigo-500" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   13. PARAMÈTRES (CdC §4.5)
══════════════════════════════════════════════════════════ */

/** Initialise l'écran Paramètres en chargeant les données affichées. */
function initParametres() {
  afficherConfigRaccourcis();
  afficherCategoriesCustom();
}

/* ── a) Raccourcis Boostage (CdC §4.5a) ── */

/** Construit les 3 blocs de configuration des raccourcis. */
function afficherConfigRaccourcis() {
  document.getElementById('raccourcis-config').innerHTML =
    raccourcisBoostage.map((r, i) => `
      <div class="space-y-1.5 p-3 bg-beige-50 dark:bg-zinc-800 rounded-xl">
        <p class="text-xs font-semibold text-gray-500 dark:text-gray-400">Raccourci ${i + 1}</p>
        <div class="grid grid-cols-2 gap-2">
          <input type="text"   value="${r.label}"   placeholder="Label"   class="wt-input text-sm" id="racc-label-${i}" />
          <input type="number" value="${r.montant}" placeholder="Montant" class="wt-input montant text-sm" id="racc-montant-${i}" />
        </div>
        <input type="text" value="${r.description}" placeholder="Description pré-remplie"
          class="wt-input text-sm" id="racc-desc-${i}" />
      </div>
    `).join('');
}

/** Persiste les 3 raccourcis modifiés dans IndexedDB. */
async function sauvegarderRaccourcis() {
  raccourcisBoostage = raccourcisBoostage.map((_, i) => ({
    label:       document.getElementById(`racc-label-${i}`)?.value   || '',
    montant:     parseFloat(document.getElementById(`racc-montant-${i}`)?.value) || 0,
    description: document.getElementById(`racc-desc-${i}`)?.value    || '',
  }));
  await dbPut('config', { cle: 'raccourcis_boostage', valeur: raccourcisBoostage });
  showToast('Raccourcis sauvegardés ✓', 'success');
}

/* ── b) Catégories personnalisées (CdC §4.5b) ── */

/** Affiche la liste des catégories custom (supprimables). */
async function afficherCategoriesCustom() {
  const categories = await dbGetAll('categories');
  const custom     = categories.filter(c => c.custom === true);
  const container  = document.getElementById('custom-categories-list');

  if (!custom.length) {
    container.innerHTML = '<p class="text-xs text-gray-400">Aucune catégorie personnalisée.</p>';
    return;
  }

  container.innerHTML = custom.map(c => `
    <div class="flex items-center justify-between p-2 bg-beige-50 dark:bg-zinc-800 rounded-lg">
      <span class="text-sm text-gray-700 dark:text-gray-300">
        ${c.emoji || '📌'} ${c.nom}
        <span class="text-gray-400 text-xs">· ${c.type} · ${c.secteur}</span>
      </span>
      <button onclick="supprimerCategorie(${c.id})"
        class="text-red-400 text-sm tap-scale px-2">✕</button>
    </div>
  `).join('');
}

/** Ajoute une catégorie personnalisée (CdC §4.5b). */
async function ajouterCategorie() {
  const nom     = document.getElementById('new-cat-nom').value.trim();
  const emoji   = document.getElementById('new-cat-emoji').value.trim() || '📌';
  const type    = document.getElementById('new-cat-type').value;
  const secteur = document.getElementById('new-cat-secteur').value;

  if (!nom) { showToast('Saisis un nom de catégorie', 'error'); return; }

  await dbAdd('categories', { nom, emoji, type, secteur, custom: true });
  document.getElementById('new-cat-nom').value   = '';
  document.getElementById('new-cat-emoji').value = '';
  showToast('Catégorie ajoutée ✓', 'success');
  afficherCategoriesCustom();
}

/**
 * Supprime une catégorie personnalisée après confirmation (CdC §4.5b & §5.5).
 * Les catégories par défaut (custom:false) ne sont pas concernées par cette fonction.
 * @param {number} id
 */
async function supprimerCategorie(id) {
  if (!confirm('Supprimer cette catégorie ?')) return; // CdC §5.5
  await dbDelete('categories', id);
  showToast('Catégorie supprimée', 'info');
  afficherCategoriesCustom();
}

/* ── c) Export / Import JSON (CdC §4.5c) ── */

/**
 * Exporte toutes les données (transactions + categories + config) dans un fichier
 * .json horodaté, téléchargé immédiatement (CdC §4.5c).
 */
async function exporterDonnees() {
  const [transactions, categories, config] = await Promise.all([
    dbGetAll('transactions'),
    dbGetAll('categories'),
    dbGetAll('config'),
  ]);

  const snapshot = {
    version:    '1.0.0',
    exportedAt: new Date().toISOString(),
    data:       { transactions, categories, config },
  };

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `windtrack_backup_${dateAujourdhui()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Données exportées ✓', 'success');
}

/**
 * Importe un fichier de sauvegarde JSON.
 * Remplacement complet (vidage des stores + réinjection) — pas de fusion (CdC §4.5c).
 * @param {Event} event — événement change du <input type="file">
 */
async function importerDonnees(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader   = new FileReader();
  reader.onload  = async (e) => {
    try {
      const snapshot = JSON.parse(e.target.result);
      if (!snapshot.data) throw new Error('Format invalide');

      /* Vider les 3 stores */
      await dbClear('transactions');
      await dbClear('categories');
      await dbClear('config');

      /* Réimporter — on retire les id pour laisser auto-increment recalculer */
      for (const cat of (snapshot.data.categories || [])) {
        const { id: _, ...rest } = cat;
        await dbAdd('categories', rest);
      }
      for (const tx of (snapshot.data.transactions || [])) {
        const { id: _, ...rest } = tx;
        await dbAdd('transactions', rest);
      }
      for (const cfg of (snapshot.data.config || [])) {
        await dbPut('config', cfg);
      }

      /* Rechargement de la config runtime */
      await chargerConfig();
      showToast('Import réussi ✓', 'success');
      navigateTo('dashboard');

    } catch (err) {
      showToast("Erreur lors de l'import", 'error');
      console.error('[WindTrack] Import :', err);
    }
  };
  reader.readAsText(file);
}

/* ── d) Réinitialisation complète (CdC §4.5d) ── */

/**
 * Vide tous les stores et réinjecte les catégories par défaut (CdC §4.5d).
 * Protégé par une boîte de dialogue de confirmation (CdC §5.5).
 */
async function reinitialiserDonnees() {
  if (!confirm('⚠️ Supprimer TOUTES tes données ? Action irréversible.')) return;
  await dbClear('transactions');
  await dbClear('categories');
  await dbClear('config');
  await seedCategories();
  showToast('Données réinitialisées', 'info');
  navigateTo('dashboard');
}

/* ══════════════════════════════════════════════════════════
   14. TOASTS (CdC §5.4)
══════════════════════════════════════════════════════════ */

/**
 * Affiche une notification toast éphémère.
 * @param {string} message   — Texte affiché
 * @param {'success'|'error'|'info'|'warning'} type — Variante de couleur
 * @param {number} duree     — Durée en ms avant disparition (défaut 3000)
 */
function showToast(message, type = 'info', duree = 3000) {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity    = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(() => toast.remove(), 300);
  }, duree);
}

/* ══════════════════════════════════════════════════════════
   15. SERVICE WORKER — PWA (CdC §2.1)
══════════════════════════════════════════════════════════ */

/** Enregistre le Service Worker pour le fonctionnement hors-ligne. */
function enregistrerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('[WindTrack] Service Worker enregistré ✓'))
      .catch(err => console.warn('[WindTrack] SW :', err));
  }
}

/* ══════════════════════════════════════════════════════════
   16. DÉMARRAGE DE L'APPLICATION (CdC §9.3)
══════════════════════════════════════════════════════════ */

/**
 * Séquence d'initialisation au chargement de la page :
 * 1. Ouverture/création de la base IndexedDB
 * 2. Seed des catégories par défaut si nécessaire
 * 3. Chargement de la configuration persistée
 * 4. Enregistrement du Service Worker
 * 5. Affichage du Tableau de bord
 */
async function demarrer() {
  try {
    await initDB();
    await seedCategories();
    await chargerConfig();
    enregistrerServiceWorker();
    navigateTo('dashboard');
    console.log('[WindTrack] Application démarrée ✓ — v1.0.0');
  } catch (err) {
    console.error('[WindTrack] Erreur démarrage :', err);
    showToast('Erreur au démarrage. Recharge la page.', 'error');
  }
}

/* Lancer dès que le DOM est prêt */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', demarrer);
} else {
  demarrer();
}

/* ============================================================
   EXTENSION RÉSEAU — app.js  v2.0.0  (CdC §7)
   Ajout du mode multi-appareils via API REST + SSE.
   L'application bascule automatiquement entre :
     - Mode SOLO  : IndexedDB local (v1, hors-ligne)
     - Mode RÉSEAU: API REST serveur + SSE temps réel
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   N.1 — ÉTAT MODE RÉSEAU
══════════════════════════════════════════════════════════ */

/**
 * URL de base du serveur WindTrack, ex: "http://192.168.1.10:3000"
 * null = mode Solo (IndexedDB uniquement).
 * Persisté dans IndexedDB sous la clé 'server_url'.
 */
let serverURL = null;

/** EventSource SSE actif (ou null si mode Solo / déconnecté). */
let sseSource = null;

/** true si le dernier ping serveur a réussi. */
let serveurEnLigne = false;

/* ══════════════════════════════════════════════════════════
   N.2 — CONFIGURATION SERVEUR (CdC §7.2)
══════════════════════════════════════════════════════════ */

/**
 * Charge l'URL serveur sauvegardée et tente la connexion.
 * Appelé depuis demarrer() après chargerConfig().
 */
async function initModeReseau() {
  const saved = await dbGet('config', 'server_url');
  if (saved?.valeur) {
    serverURL = saved.valeur;
    await connecterServeur(serverURL, false);
  }
  mettreAJourBandeau();
}

/**
 * Tente de se connecter au serveur donné (CdC §7.2).
 * - Ping GET /api/status
 * - Si OK : charge toutes les données depuis le serveur, ouvre SSE
 * - Si KO : reste en mode Solo
 * @param {string}  url       — ex: "http://192.168.1.10:3000"
 * @param {boolean} afficherToast
 */
async function connecterServeur(url, afficherToast = true) {
  url = url.replace(/\/$/, ''); // retirer trailing slash
  try {
    const res = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    serverURL      = url;
    serveurEnLigne = true;

    /* Persister l'URL */
    await dbPut('config', { cle: 'server_url', valeur: url });

    /* Ouvrir le flux SSE */
    ouvrirSSE();

    if (afficherToast) showToast('Connecté au serveur ✓', 'success');
    console.log('[Réseau] Connecté à', url);

  } catch (err) {
    serveurEnLigne = false;
    serverURL      = null;
    if (afficherToast) showToast('Serveur inaccessible — mode Solo activé', 'warning');
    console.warn('[Réseau] Connexion échouée :', err.message);
  }
  mettreAJourBandeau();
}

/** Déconnecte du serveur et repasse en mode Solo. */
async function deconnecterServeur() {
  fermerSSE();
  serverURL      = null;
  serveurEnLigne = false;
  await dbDelete('config', 'server_url');
  mettreAJourBandeau();
  showToast('Mode Solo activé', 'info');
  rafraichirEcranCourant();
}

/* ══════════════════════════════════════════════════════════
   N.3 — SSE (Server-Sent Events) (CdC §7.3)
══════════════════════════════════════════════════════════ */

/** Ouvre la connexion SSE vers /api/events. */
function ouvrirSSE() {
  fermerSSE(); // fermer l'ancienne connexion si elle existe
  if (!serverURL) return;

  sseSource = new EventSource(`${serverURL}/api/events`);

  sseSource.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    traiterEvenementSSE(msg);
  };

  sseSource.onerror = () => {
    serveurEnLigne = false;
    mettreAJourBandeau();
    console.warn('[SSE] Connexion perdue — tentative de reconnexion auto par le navigateur');
  };

  sseSource.onopen = () => {
    serveurEnLigne = true;
    mettreAJourBandeau();
    console.log('[SSE] Flux ouvert');
  };
}

/** Ferme la connexion SSE proprement. */
function fermerSSE() {
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
}

/**
 * Traite un événement SSE reçu du serveur.
 * Met à jour l'UI de l'écran courant en temps réel (CdC §7.3).
 * @param {{type:string, payload:any}} msg
 */
function traiterEvenementSSE(msg) {
  console.log('[SSE] Événement reçu :', msg.type);

  switch (msg.type) {
    case 'connected':
      break; // ping initial, rien à faire

    case 'transaction_created':
    case 'transaction_deleted':
    case 'category_created':
    case 'category_deleted':
    case 'config_updated':
      /* Rafraîchir l'écran courant pour refléter la modification */
      rafraichirEcranCourant();
      break;

    default:
      break;
  }
}

/** Rafraîchit les données de l'écran actuellement affiché. */
function rafraichirEcranCourant() {
  switch (ecranCourant) {
    case 'dashboard':  rafraichirDashboard();  break;
    case 'historique': rafraichirHistorique();  break;
    case 'graphiques': rafraichirGraphiques();  break;
    case 'parametres': initParametres();        break;
    default: break;
  }
}

/* ══════════════════════════════════════════════════════════
   N.4 — COUCHE D'ACCÈS AUX DONNÉES UNIFIÉE (CdC §7.4)
   Toutes les fonctions de lecture/écriture passent
   par ces wrappers qui choisissent automatiquement
   entre IndexedDB (Solo) et API REST (Réseau).
══════════════════════════════════════════════════════════ */

/**
 * Retourne toutes les catégories depuis la source active.
 * @returns {Promise<any[]>}
 */
async function getCategories() {
  if (serveurEnLigne && serverURL) {
    const res = await fetch(`${serverURL}/api/categories`);
    if (!res.ok) throw new Error('API /categories KO');
    return res.json();
  }
  return dbGetAll('categories');
}

/**
 * Retourne toutes les transactions depuis la source active.
 * @returns {Promise<any[]>}
 */
async function getTransactions() {
  if (serveurEnLigne && serverURL) {
    const res = await fetch(`${serverURL}/api/transactions`);
    if (!res.ok) throw new Error('API /transactions KO');
    return res.json();
  }
  return dbGetAll('transactions');
}

/**
 * Crée une transaction dans la source active.
 * En mode réseau : envoie local_uid pour déduplication (CdC §7.4c).
 * @param {{montant,category_id,description,date}} data
 * @returns {Promise<any>} transaction créée
 */
async function creerTransaction(data) {
  /* local_uid : identifiant unique côté client pour éviter les doublons
     lors d'une reconnexion après perte temporaire (CdC §7.4c) */
  const local_uid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  if (serveurEnLigne && serverURL) {
    const res = await fetch(`${serverURL}/api/transactions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...data, local_uid }),
    });
    if (!res.ok) throw new Error('API POST /transactions KO');
    return res.json();
  }

  /* Mode Solo : IndexedDB */
  const id = await dbAdd('transactions', {
    ...data,
    local_uid,
    createdAt: new Date().toISOString(),
  });
  return { id, ...data, local_uid };
}

/**
 * Supprime une transaction dans la source active.
 * @param {number} id
 */
async function supprimerTransactionAPI(id) {
  if (serveurEnLigne && serverURL) {
    const res = await fetch(`${serverURL}/api/transactions/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API DELETE /transactions/${id} KO`);
    return;
  }
  await dbDelete('transactions', id);
}

/**
 * Crée une catégorie dans la source active.
 * @param {{nom,type,secteur,emoji,custom}} data
 * @returns {Promise<any>}
 */
async function creerCategorieAPI(data) {
  if (serveurEnLigne && serverURL) {
    const res = await fetch(`${serverURL}/api/categories`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    if (!res.ok) throw new Error('API POST /categories KO');
    return res.json();
  }
  const id = await dbAdd('categories', data);
  return { id, ...data };
}

/**
 * Supprime une catégorie dans la source active.
 * @param {number} id
 */
async function supprimerCategorieAPI(id) {
  if (serveurEnLigne && serverURL) {
    const res = await fetch(`${serverURL}/api/categories/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API DELETE /categories/${id} KO`);
    return;
  }
  await dbDelete('categories', id);
}

/* ══════════════════════════════════════════════════════════
   N.5 — BANDEAU DE STATUT (CdC §7.6)
   Indicateur visuel du mode actif affiché sous le header.
══════════════════════════════════════════════════════════ */

/** Met à jour l'affichage du bandeau de statut réseau. */
function mettreAJourBandeau() {
  let bandeau = document.getElementById('bandeau-reseau');

  if (!bandeau) {
    /* Créer le bandeau s'il n'existe pas encore */
    bandeau = document.createElement('div');
    bandeau.id = 'bandeau-reseau';
    bandeau.style.cssText =
      'height:28px;min-height:28px;display:flex;align-items:center;justify-content:center;' +
      'font-size:11px;font-weight:600;letter-spacing:0.04em;flex-shrink:0;' +
      'transition:background .3s;cursor:pointer;z-index:19;';
    bandeau.onclick = () => navigateTo('parametres');

    /* Insérer entre le header et le <main> */
    const header = document.querySelector('header');
    const main   = document.querySelector('main');
    if (header && main) {
      header.parentNode.insertBefore(bandeau, main);
    }
  }

  if (serveurEnLigne && serverURL) {
    bandeau.style.background = 'rgba(21,128,61,0.12)';
    bandeau.style.color      = '#15803D';
    bandeau.style.borderBottom = '1px solid rgba(21,128,61,0.2)';
    bandeau.innerHTML = `🌐 Mode Réseau — ${serverURL.replace('http://','')} · Tap pour paramètres`;
  } else {
    bandeau.style.background = 'rgba(217,119,6,0.10)';
    bandeau.style.color      = '#B45309';
    bandeau.style.borderBottom = '1px solid rgba(217,119,6,0.2)';
    bandeau.innerHTML = serverURL
      ? '⚠️ Serveur hors-ligne — Mode Solo (données locales)'
      : '📱 Mode Solo — Données locales uniquement · Tap pour connecter';
  }
}

/* ══════════════════════════════════════════════════════════
   N.6 — SURCHARGE DES FONCTIONS DE L'ÉCRAN PARAMÈTRES
   Injecte le panneau de connexion réseau (CdC §7.2)
   et redirige ajouterCategorie / supprimerCategorie
   vers les wrappers unifiés.
══════════════════════════════════════════════════════════ */

/**
 * Surcharge de initParametres() :
 * ajoute le panneau de connexion réseau en tête de l'écran.
 * Les fonctions précédentes (raccourcis, catégories, export…) sont conservées.
 */
const _initParametresOriginal = initParametres;
function initParametres() {
  _initParametresOriginal();
  injecterPanneauReseau();
}

/** Injecte (ou met à jour) le panneau de configuration réseau dans l'écran Paramètres. */
function injecterPanneauReseau() {
  const ecran = document.getElementById('screen-parametres');
  if (!ecran) return;

  /* Supprimer l'ancien panneau si présent */
  document.getElementById('panneau-reseau')?.remove();

  const panneau = document.createElement('div');
  panneau.id = 'panneau-reseau';
  panneau.className = 'card flex-shrink-0';
  panneau.innerHTML = `
    <p class="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
      🌐 Synchronisation multi-appareils
    </p>
    <p class="text-xs text-gray-400 mb-4">
      Lance le serveur sur ce téléphone (Termux) ou un autre appareil du même Wi-Fi,
      puis entre son adresse IP pour synchroniser les données en temps réel.
    </p>

    <!-- Statut actuel -->
    <div id="reseau-statut" class="flex items-center gap-2 mb-4 p-3 rounded-xl text-sm font-medium
      ${serveurEnLigne ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'}">
      <span>${serveurEnLigne ? '🟢' : '🔴'}</span>
      <span>${serveurEnLigne ? `Connecté — ${serverURL}` : 'Non connecté — Mode Solo'}</span>
    </div>

    <!-- Champ URL -->
    <div class="space-y-2 mb-3">
      <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        Adresse du serveur
      </label>
      <input id="input-server-url" type="url" inputmode="url"
        class="wt-input font-mono text-sm"
        placeholder="http://192.168.1.10:3000"
        value="${serverURL || ''}" />
      <p class="text-xs text-gray-400">
        💡 Lance d'abord le serveur dans Termux, puis note l'IP affichée.
      </p>
    </div>

    <!-- Boutons -->
    <div class="flex gap-2">
      <button onclick="demanderConnexion()"
        class="flex-1 py-3 rounded-xl bg-indigo-500 text-white text-sm font-semibold tap-scale transition-transform">
        🔗 Connecter
      </button>
      ${serveurEnLigne ? `
      <button onclick="deconnecterServeur()"
        class="flex-1 py-3 rounded-xl border border-gray-300 dark:border-zinc-600
               text-gray-600 dark:text-gray-300 text-sm font-semibold tap-scale transition-transform">
        ✕ Déconnecter
      </button>` : ''}
    </div>

    <!-- Guide rapide -->
    <details class="mt-4">
      <summary class="text-xs font-semibold text-indigo-500 cursor-pointer select-none">
        📖 Guide d'installation Termux
      </summary>
      <div class="mt-3 space-y-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        <p><strong class="text-gray-700 dark:text-gray-200">1.</strong> Installe Termux depuis F-Droid</p>
        <p><strong class="text-gray-700 dark:text-gray-200">2.</strong> Dans Termux :</p>
        <pre class="bg-gray-100 dark:bg-zinc-800 rounded-lg p-3 text-[10px] overflow-x-auto">pkg update && pkg install nodejs
cd /sdcard
cp -r windtrack/server windtrack-server
cd windtrack-server
npm install
node server.js</pre>
        <p><strong class="text-gray-700 dark:text-gray-200">3.</strong> Note l'adresse IP affichée</p>
        <p><strong class="text-gray-700 dark:text-gray-200">4.</strong> Entre-la ci-dessus sur tous tes appareils</p>
        <p class="text-indigo-400">✓ Les données se synchronisent automatiquement en temps réel</p>
      </div>
    </details>
  `;

  /* Insérer en premier dans l'écran paramètres */
  ecran.insertBefore(panneau, ecran.firstChild);
}

/** Lit l'URL saisie et tente la connexion. */
async function demanderConnexion() {
  const input = document.getElementById('input-server-url');
  const url   = input?.value?.trim();
  if (!url) { showToast('Entre une adresse serveur', 'error'); return; }
  showToast('Connexion en cours…', 'info', 2000);
  await connecterServeur(url, true);
  injecterPanneauReseau(); // rafraîchir le panneau
}

/* ══════════════════════════════════════════════════════════
   N.7 — SURCHARGE DES FONCTIONS MÉTIER
   Les fonctions originales (dashboard, historique, saisie…)
   appellaient dbGetAll() directement. On les remplace
   pour qu'elles passent par les wrappers unifiés.
══════════════════════════════════════════════════════════ */

/* ── Dashboard ── */
const _rafraichirDashboardOriginal = rafraichirDashboard;
rafraichirDashboard = async function() {
  if (!serveurEnLigne) { return _rafraichirDashboardOriginal(); }

  /* Mode réseau : charger via API */
  try {
    const [toutes, categories] = await Promise.all([
      getTransactions(),
      getCategories(),
    ]);
    _rafraichirDashboardAvecDonnees(toutes, categories);
  } catch (err) {
    console.error('[Dashboard] Erreur API :', err);
    _rafraichirDashboardOriginal(); // fallback local
  }
};

/**
 * Version découplée du dashboard qui accepte les données en paramètre.
 * Permet d'utiliser les données venant soit de l'API soit d'IndexedDB.
 */
async function _rafraichirDashboardAvecDonnees(toutes, categories) {
  const txPeriode = filtrerParPeriode(toutes, periodeActive);
  const entrees   = sommeParType(txPeriode, categories, 'Entrée');
  const sorties   = sommeParType(txPeriode, categories, 'Sortie');
  const solde     = entrees - sorties;

  const soldeCard = document.getElementById('solde-card');
  document.getElementById('solde-value').textContent = (solde >= 0 ? '+' : '') + fCFA(solde);
  soldeCard.classList.toggle('negative', solde < 0);

  const mp             = getMoisPrecedent();
  const txMoisPrec     = toutes.filter(tx => tx.date >= mp.debut && tx.date <= mp.fin);
  const soldePrecedent = calculerSolde(txMoisPrec, categories);
  afficherTendance(solde, soldePrecedent);

  document.getElementById('total-entrees').textContent = fCFA(entrees);
  document.getElementById('total-sorties').textContent = fCFA(sorties);

  const secteurs = ['Professionnel', 'Personnel', 'Académique'];
  const parSect  = {};
  secteurs.forEach(s => { parSect[s] = 0; });
  txPeriode.forEach(tx => {
    const cat = categories.find(c => c.id === tx.category_id);
    if (cat?.type === 'Sortie' && parSect[cat.secteur] !== undefined)
      parSect[cat.secteur] += tx.montant;
  });
  const totalSorties2 = Object.values(parSect).reduce((a, b) => a + b, 0) || 1;
  const pcts = {
    Professionnel: Math.round((parSect.Professionnel / totalSorties2) * 100),
    Personnel:     Math.round((parSect.Personnel     / totalSorties2) * 100),
    Académique:    Math.round((parSect.Académique    / totalSorties2) * 100),
  };
  document.getElementById('pct-pro').textContent   = pcts.Professionnel + '%';
  document.getElementById('pct-perso').textContent = pcts.Personnel     + '%';
  document.getElementById('pct-acad').textContent  = pcts.Académique    + '%';
  document.getElementById('bar-pro').style.width   = pcts.Professionnel + '%';
  document.getElementById('bar-perso').style.width = pcts.Personnel     + '%';
  document.getElementById('bar-acad').style.width  = pcts.Académique    + '%';

  const EMOJIS_SECT = { Professionnel: '💼', Personnel: '🏠', Académique: '🎓' };
  let bilanHTML = '';
  for (const sect of secteurs) {
    const e = sommeParTypeEtSecteur(txPeriode, categories, 'Entrée', sect);
    const s = sommeParTypeEtSecteur(txPeriode, categories, 'Sortie', sect);
    const b = e - s;
    const c = b >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400';
    bilanHTML += `<div class="flex items-center justify-between py-1.5">
      <span class="text-sm text-gray-600 dark:text-gray-300">${EMOJIS_SECT[sect]} ${sect}</span>
      <span class="montant text-sm font-semibold ${c}">${b >= 0 ? '+' : ''}${fCFA(b)}</span>
    </div>`;
  }
  document.getElementById('bilan-secteurs').innerHTML =
    bilanHTML || '<p class="text-sm text-gray-400">Aucune donnée.</p>';

  const recentes  = [...txPeriode].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const recentesEl = document.getElementById('recentes-list');
  if (!recentes.length) {
    recentesEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Aucune transaction.</p>';
    return;
  }
  recentesEl.innerHTML = recentes.map(tx => renderTxRow(tx, categories, false)).join('');
}

/* ── Historique ── */
const _rafraichirHistoriqueOriginal = rafraichirHistorique;
rafraichirHistorique = async function() {
  if (!serveurEnLigne) { return _rafraichirHistoriqueOriginal(); }
  try {
    const [toutes, categories] = await Promise.all([getTransactions(), getCategories()]);
    let filtrees = filtrerParPeriode(toutes, histPeriode);
    if (histType !== 'all') {
      filtrees = filtrees.filter(tx => {
        const cat = categories.find(c => c.id === tx.category_id);
        return cat?.type === histType;
      });
    }
    filtrees.sort((a, b) => b.date.localeCompare(a.date));
    const container = document.getElementById('historique-list');
    if (!filtrees.length) {
      container.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Aucune transaction.</p>';
      return;
    }
    container.innerHTML = filtrees.map(tx => renderTxRow(tx, categories, true)).join('');
    container.querySelectorAll('.tx-row').forEach(row => {
      let timer;
      row.addEventListener('touchstart', () => {
        timer = setTimeout(() => {
          container.querySelectorAll('.tx-row').forEach(r => r.classList.remove('reveal'));
          row.classList.add('reveal');
        }, 500);
      }, { passive: true });
      row.addEventListener('touchend',  () => clearTimeout(timer));
      row.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
    });
  } catch (err) {
    console.error('[Historique] Erreur API :', err);
    _rafraichirHistoriqueOriginal();
  }
};

/* ── Graphiques ── */
const _rafraichirGraphiquesOriginal = rafraichirGraphiques;
rafraichirGraphiques = async function() {
  if (!serveurEnLigne) { return _rafraichirGraphiquesOriginal(); }
  try {
    const [toutes, categories] = await Promise.all([getTransactions(), getCategories()]);
    dessinerGraphique6Mois(toutes, categories);
    afficherStats(toutes, categories);
    afficherTopCategories(toutes, categories);
  } catch (err) {
    _rafraichirGraphiquesOriginal();
  }
};

/* ── Saisie : enregistrerTransaction ── */
const _enregistrerTransactionOriginal = enregistrerTransaction;
enregistrerTransaction = async function() {
  const montant     = parseFloat(document.getElementById('input-montant').value);
  const catId       = parseInt(document.getElementById('input-categorie').value);
  const description = document.getElementById('input-description').value.trim();
  const date        = document.getElementById('input-date').value;

  if (!montant || montant <= 0) { showToast('Saisis un montant valide (> 0)', 'error'); return; }
  if (!catId)                   { showToast('Sélectionne une catégorie', 'error');       return; }
  if (!date)                    { showToast('Sélectionne une date', 'error');             return; }

  try {
    await creerTransaction({
      montant,
      category_id: catId,
      description: description || null,
      date,
      createdAt:   new Date().toISOString(),
    });
    showToast('Transaction enregistrée ✓', 'success');
    document.getElementById('input-montant').value     = '';
    document.getElementById('input-description').value = '';
    document.getElementById('raccourcis-boostage').classList.add('hidden');
    setTimeout(() => navigateTo('dashboard'), 600);
  } catch (err) {
    console.error('[Saisie] :', err);
    showToast("Erreur lors de l'enregistrement", 'error');
  }
};

/* ── Historique : supprimerTransaction ── */
const _supprimerTransactionOriginal = supprimerTransaction;
supprimerTransaction = async function(id) {
  if (!confirm('Supprimer cette transaction ?')) return;
  try {
    await supprimerTransactionAPI(id);
    showToast('Transaction supprimée', 'info');
    rafraichirHistorique();
  } catch (err) {
    showToast('Erreur lors de la suppression', 'error');
  }
};

/* ── Paramètres : ajouterCategorie ── */
const _ajouterCategorieOriginal = ajouterCategorie;
ajouterCategorie = async function() {
  const nom     = document.getElementById('new-cat-nom').value.trim();
  const emoji   = document.getElementById('new-cat-emoji').value.trim() || '📌';
  const type    = document.getElementById('new-cat-type').value;
  const secteur = document.getElementById('new-cat-secteur').value;
  if (!nom) { showToast('Saisis un nom de catégorie', 'error'); return; }
  try {
    await creerCategorieAPI({ nom, emoji, type, secteur, custom: true });
    document.getElementById('new-cat-nom').value   = '';
    document.getElementById('new-cat-emoji').value = '';
    showToast('Catégorie ajoutée ✓', 'success');
    afficherCategoriesCustom();
  } catch (err) {
    showToast("Erreur lors de l'ajout", 'error');
  }
};

/* ── Paramètres : supprimerCategorie ── */
const _supprimerCategorieOriginal = supprimerCategorie;
supprimerCategorie = async function(id) {
  if (!confirm('Supprimer cette catégorie ?')) return;
  try {
    await supprimerCategorieAPI(id);
    showToast('Catégorie supprimée', 'info');
    afficherCategoriesCustom();
  } catch (err) {
    showToast('Erreur lors de la suppression', 'error');
  }
};

/* ── chargerCategories (formulaire de saisie) ── */
const _chargerCategoriesOriginal = chargerCategories;
chargerCategories = async function() {
  const categories = await getCategories();
  const filtrees   = categories.filter(c => c.type === typeCourant);
  const select     = document.getElementById('input-categorie');
  select.innerHTML =
    '<option value="">Sélectionner une catégorie…</option>' +
    filtrees.map(c => `<option value="${c.id}">${c.emoji || ''} ${c.nom}</option>`).join('');
  document.getElementById('raccourcis-boostage').classList.add('hidden');
};

/* ── afficherCategoriesCustom ── */
const _afficherCategoriesCustomOriginal = afficherCategoriesCustom;
afficherCategoriesCustom = async function() {
  const categories = await getCategories();
  const custom     = categories.filter(c => c.custom === true || c.custom === 1);
  const container  = document.getElementById('custom-categories-list');
  if (!custom.length) {
    container.innerHTML = '<p class="text-xs text-gray-400">Aucune catégorie personnalisée.</p>';
    return;
  }
  container.innerHTML = custom.map(c => `
    <div class="flex items-center justify-between p-2 bg-beige-50 dark:bg-zinc-800 rounded-lg">
      <span class="text-sm text-gray-700 dark:text-gray-300">
        ${c.emoji || '📌'} ${c.nom}
        <span class="text-gray-400 text-xs">· ${c.type} · ${c.secteur}</span>
      </span>
      <button onclick="supprimerCategorie(${c.id})" class="text-red-400 text-sm tap-scale px-2">✕</button>
    </div>
  `).join('');
};

/* ══════════════════════════════════════════════════════════
   N.8 — SURCHARGE DE demarrer() POUR INCLURE LE RÉSEAU
══════════════════════════════════════════════════════════ */

/* Remplacer la fonction demarrer() originale */
const _demarrerOriginal = demarrer;

/* On ne peut pas redéclarer une const/let, donc on détache
   le listener existant et on recrée le démarrage complet. */
document.removeEventListener('DOMContentLoaded', demarrer);

async function demarrerV2() {
  try {
    await initDB();
    await seedCategories();
    await chargerConfig();
    await initModeReseau();     // ← Nouveau : tente la connexion réseau
    enregistrerServiceWorker();
    navigateTo('dashboard');
    console.log('[WindTrack] Application démarrée ✓ — v2.0.0 (réseau)');
  } catch (err) {
    console.error('[WindTrack] Erreur démarrage :', err);
    showToast('Erreur au démarrage. Recharge la page.', 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', demarrerV2);
} else {
  demarrerV2();
}
