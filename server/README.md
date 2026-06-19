# WindTrack — Serveur réseau local

## Prérequis

- Termux (F-Droid) ou n'importe quel PC/Raspberry Pi avec Node.js ≥ 18

---

## Installation sur Android (Termux)

```bash
# 1. Installer Node.js dans Termux
pkg update && pkg install nodejs

# 2. Accorder l'accès au stockage
termux-setup-storage

# 3. Copier le dossier server/ sur la carte SD
cp -r /sdcard/windtrack/server ~/windtrack-server

# 4. Installer les dépendances
cd ~/windtrack-server
npm install

# 5. Lancer le serveur
node server.js
```

Le terminal affiche alors :

```
╔══════════════════════════════════════════════╗
║          WindTrack Serveur v1.0.0            ║
╠══════════════════════════════════════════════╣
║  Serveur démarré sur le port : 3000          ║
║                                              ║
║  Accès depuis ce téléphone :                 ║
║  ➤  http://localhost:3000                    ║
║                                              ║
║  Accès depuis les autres appareils Wi-Fi :   ║
║  ➤  http://192.168.1.10:3000                 ║
╚══════════════════════════════════════════════╝
```

---

## Connexion depuis l'application

1. Ouvre WindTrack sur n'importe quel appareil du même réseau Wi-Fi
2. Va dans **Paramètres → Synchronisation multi-appareils**
3. Entre l'adresse affichée par le serveur (ex: `http://192.168.1.10:3000`)
4. Appuie sur **Connecter**

Le bandeau vert en haut confirme la connexion.  
Toutes les modifications sont synchronisées **en temps réel** sur tous les appareils connectés.

---

## Structure des fichiers

```
windtrack/
├── index.html          ← Application web (servi par Express aussi)
├── app.js              ← Logique SPA (Solo + Réseau)
├── sw.js               ← Service Worker PWA
├── manifest.json       ← Manifest PWA
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── server/
    ├── server.js       ← Serveur Express + SSE
    ├── db.js           ← Couche SQLite (better-sqlite3)
    ├── package.json
    ├── windtrack.sqlite ← Créé automatiquement au premier lancement
    └── README.md       ← Ce fichier
```

---

## Endpoints API REST

| Méthode | Endpoint                  | Description                        |
|---------|---------------------------|------------------------------------|
| GET     | `/api/status`             | Statut serveur + IP + nb. clients  |
| GET     | `/api/categories`         | Liste toutes les catégories        |
| POST    | `/api/categories`         | Crée une catégorie                 |
| DELETE  | `/api/categories/:id`     | Supprime une catégorie             |
| GET     | `/api/transactions`       | Liste toutes les transactions      |
| POST    | `/api/transactions`       | Crée une transaction               |
| DELETE  | `/api/transactions/:id`   | Supprime une transaction           |
| GET     | `/api/config`             | Lit toute la configuration         |
| PUT     | `/api/config/:cle`        | Met à jour une entrée de config    |
| GET     | `/api/events`             | Flux SSE (temps réel)              |

---

## Notes techniques

- **Base de données** : SQLite via `better-sqlite3` (mode WAL)
- **Synchronisation** : Server-Sent Events (SSE) — connexion longue durée, unidirectionnelle serveur → clients
- **Déduplication** : chaque transaction porte un `local_uid` généré côté client pour éviter les doublons en cas de reconnexion
- **Mode dégradé** : si le serveur est inaccessible, l'application fonctionne automatiquement en mode Solo (IndexedDB)
