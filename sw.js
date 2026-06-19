/* ============================================================
   WindTrack — sw.js  v1.0.0
   Service Worker · Stratégie Cache First · Offline-First
   Conforme CdC §2.1 (comportement PWA)
   ============================================================ */

'use strict';

/* Nom du cache — incrémenter à chaque mise à jour déployée */
const CACHE_NAME = 'windtrack-v1.0.0';

/* Ressources à mettre en cache lors de l'installation (CdC §9.1) */
const FICHIERS_A_CACHER = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ── INSTALL ────────────────────────────────────────────────
   Mise en cache de toutes les ressources statiques.
   skipWaiting() force l'activation immédiate sans attendre
   que tous les onglets clients soient fermés.              */
self.addEventListener('install', (event) => {
  console.log('[SW] Installation — mise en cache des ressources');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FICHIERS_A_CACHER))
      .then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE ───────────────────────────────────────────────
   Suppression des caches obsolètes (versions précédentes).
   clients.claim() prend le contrôle immédiatement.        */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation — nettoyage des anciens caches');
  event.waitUntil(
    caches.keys()
      .then(noms =>
        Promise.all(
          noms
            .filter(nom => nom !== CACHE_NAME)
            .map(nom => {
              console.log('[SW] Suppression ancien cache :', nom);
              return caches.delete(nom);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ── FETCH ──────────────────────────────────────────────────
   Stratégie Cache First pour les ressources locales :
   - Sert depuis le cache si disponible.
   - Sinon, tente le réseau et met en cache la réponse.
   - En cas d'échec hors-ligne, retourne index.html.

   Stratégie Network First pour les ressources CDN
   (Google Fonts, Tailwind CDN) :
   - Tente le réseau en priorité.
   - En cas d'échec, sert depuis le cache.               */
self.addEventListener('fetch', (event) => {
  /* Ignorer les requêtes non-GET et les extensions Chrome */
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  const url     = new URL(event.request.url);
  const estLocal = url.origin === self.location.origin;

  if (estLocal) {
    /* Ressources locales → Cache First */
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;

        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        }).catch(() => {
          /* Hors-ligne et non mis en cache → page principale */
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
      })
    );
  } else {
    /* CDN externes → Network First */
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
  }
});

/* ── MESSAGE ────────────────────────────────────────────────
   Permet à l'application de demander une mise à jour
   forcée du Service Worker (ex: après un déploiement).    */
self.addEventListener('message', (event) => {
  if (event.data?.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
