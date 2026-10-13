const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, '..', 'db');
const DB_FILE = process.env.DB_FILE || path.join(DB_DIR, 'heritage.db');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS dishes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price       INTEGER NOT NULL CHECK (price >= 0), -- en FCFA
    category_id INTEGER NOT NULL REFERENCES categories(id),
    photo_url   TEXT,
    available   INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1))
  );

  -- Administration (étape 6) : un seul compte, sessions gardées côté serveur
  CREATE TABLE IF NOT EXISTS admin (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,                  -- bcrypt, jamais le mot de passe lui-même
    must_change   INTEGER NOT NULL DEFAULT 1 CHECK (must_change IN (0, 1)),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id_hash    TEXT PRIMARY KEY,                  -- SHA-256 du cookie : une fuite de la base ne donne aucune session valide
    csrf       TEXT NOT NULL,
    created_at INTEGER NOT NULL,                  -- millisecondes
    last_seen  INTEGER NOT NULL
  );

  -- Commandes reçues par le site (étape 5). Le total est calculé par le serveur.
  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reference      TEXT NOT NULL UNIQUE,
    customer_name  TEXT NOT NULL,
    phone          TEXT NOT NULL,
    requested_for  TEXT NOT NULL,                 -- 'AAAA-MM-JJTHH:MM', heure de Yaoundé
    total          INTEGER NOT NULL CHECK (total >= 0), -- FCFA
    status         TEXT NOT NULL DEFAULT 'nouvelle',
    email_sent     INTEGER NOT NULL DEFAULT 0 CHECK (email_sent IN (0, 1)),
    email_attempts INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    dish_id    INTEGER,                           -- peut disparaître du menu plus tard
    name       TEXT NOT NULL,                     -- copie du nom au moment de la commande
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    qty        INTEGER NOT NULL CHECK (qty >= 1)
  );
`);

// Categories de base (idempotent)
const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
['Grillades', 'Plats locaux', 'Occidental', 'Boissons'].forEach((n) => insertCategory.run(n));

// Plats de démonstration (uniquement si la table est vide). Prix en FCFA.
// À remplacer par les vrais plats via l'interface /admin (étape 6).
const SEED = {
  'Grillades': [
    ['Poulet braisé', 'Poulet mariné aux épices, braisé au feu de bois, servi avec plantain ou bâton de manioc.', 6500, 1],
    ['Poisson braisé', 'Bar entier braisé, sauce pimentée à part, accompagné de miondo ou de plantain.', 8000, 1],
    ['Brochettes de bœuf', 'Six brochettes grillées, oignons et piment frais.', 3500, 1],
    ['Soya', 'Fines tranches de bœuf épicées au mélange yaji, grillées à la minute.', 2500, 1],
  ],
  'Plats locaux': [
    ['Ndolé aux crevettes', 'Feuilles de ndolé mijotées avec arachides et crevettes, servi avec plantain mûr.', 5500, 1],
    ['Taro sauce jaune', 'Taro pilé, sauce jaune à l’huile de palme et viande de bœuf.', 5000, 0],
    ['Poulet DG', 'Poulet sauté, plantains frits et légumes du marché.', 6500, 1],
    ['Eru et water fufu', 'Feuilles d’eru, peau de bœuf et poisson fumé, avec water fufu.', 5000, 1],
  ],
  'Occidental': [
    ['Burger Heritage', 'Pain brioché, steak de bœuf, cheddar, oignons caramélisés, frites maison.', 4500, 1],
    ['Pizza margherita', 'Sauce tomate, mozzarella, basilic.', 5500, 1],
    ['Pizza quatre fromages', 'Mozzarella, chèvre, gorgonzola, emmental.', 6500, 1],
    ['Tacos poulet', 'Galette de blé, poulet mariné, salade, fromage fondu, frites.', 4000, 1],
  ],
  'Boissons': [
    ['Eau minérale', 'Bouteille de 1,5 litre.', 500, 1],
    ['Jus de gingembre maison', 'Gingembre frais, citron, un peu de sucre.', 1000, 1],
    ['Jus de bissap', 'Fleurs d’hibiscus infusées, servi bien frais.', 1000, 1],
    ['Jus d’ananas frais', 'Pressé le jour même.', 1500, 1],
  ],
};
const PHOTO = {
  'Grillades': '/img/placeholder-grillades.svg',
  'Plats locaux': '/img/placeholder-locaux.svg',
  'Occidental': '/img/placeholder-occidental.svg',
  'Boissons': '/img/placeholder-boissons.svg',
};

if (db.prepare('SELECT COUNT(*) AS n FROM dishes').get().n === 0) {
  const catId = db.prepare('SELECT id FROM categories WHERE name = ?');
  const insertDish = db.prepare(
    'INSERT INTO dishes (name, description, price, category_id, photo_url, available) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (const [cat, dishes] of Object.entries(SEED)) {
      const id = catId.get(cat).id;
      dishes.forEach(([name, desc, price, available]) =>
        insertDish.run(name, desc, price, id, PHOTO[cat], available)
      );
    }
  })();
}

module.exports = db;
