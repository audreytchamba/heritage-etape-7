const path = require('path');
const express = require('express');
const db = require('./db');
const config = require('./config');
const { creerOrders } = require('./orders');
const { modeTest } = require('./mailer');
const { creerAdmin, entetesAdmin } = require('./admin/routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

// Derrière un proxy (hébergeur, nginx) : TRUST_PROXY=1 pour que req.ip soit l'adresse du visiteur
// (nécessaire à la limitation des tentatives) et que le cookie admin soit marqué "secure" en HTTPS.
// On n'accepte qu'un nombre de proxys, jamais "true" : sinon n'importe qui pourrait falsifier son adresse.
if (/^\d+$/.test(process.env.TRUST_PROXY || '')) app.set('trust proxy', Number(process.env.TRUST_PROXY));

// En-têtes de sécurité du site public. Aucune page n'a de script ni de style en ligne : la CSP peut être stricte.
// Seules exceptions : Google Fonts (polices) et la carte OpenStreetMap (iframe).
const CSP_PUBLIC = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  'frame-src https://www.openstreetmap.org',
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP_PUBLIC,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  // HTTPS obligatoire pendant 6 mois (uniquement en production : en local on est en http)
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

// En-têtes de sécurité de /admin : remplacent ceux du site public, pages et API comprises
app.use('/admin', entetesAdmin);

app.use(express.static(path.join(__dirname, '..', 'public')));

// Photos des plats envoyées depuis /admin. Noms aléatoires : cache longue durée, jamais interprétées comme du code.
app.use('/uploads', express.static(config.admin.dossierPhotos, {
  index: false,
  dotfiles: 'ignore',
  maxAge: '365d',
  immutable: true,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
  },
}));

app.use(express.json({ limit: '10kb' })); // une commande ou un formulaire admin tient en quelques centaines d'octets

const orders = creerOrders(db);
app.locals.orders = orders;
app.use(orders.router);

const admin = creerAdmin(db);
app.locals.admin = admin;
const adminInitial = admin.auth.initialiserAdmin(); // crée le compte au tout premier démarrage
app.use('/admin/api', admin.router);

app.get('/health', (req, res) => {
  res.type('text').send('OK');
});

// Menu public : catégories et plats (requêtes sans paramètre utilisateur)
app.get('/api/menu', (req, res) => {
  const categories = db.prepare('SELECT id, name FROM categories ORDER BY id').all();
  const dishes = db
    .prepare(
      `SELECT id, name, description, price, category_id AS categoryId, photo_url AS photoUrl, available
       FROM dishes ORDER BY category_id, id`
    )
    .all()
    .map((d) => ({ ...d, available: d.available === 1 }));
  res.json({ categories, dishes });
});

// Réglages publics nécessaires à la page de commande (rien de secret ici)
app.get('/api/config', (req, res) => {
  res.json({
    whatsapp: config.whatsapp,
    timezone: config.timezone,
    delaiMinimum: config.delaiMinimum,
    joursMax: config.joursMax,
    horaires: config.horaires,
    modesCommande: config.modesCommande,
  });
});

// Erreurs de l'API en JSON (JSON mal formé, corps trop gros) plutôt qu'une page HTML
app.use(['/api', '/admin/api'], (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ erreur: status === 413 ? 'Fichier ou requête trop volumineux.' : status === 500 ? 'Erreur du serveur.' : 'Requête non valide.' });
});

// Pages inconnues et erreurs : message simple, jamais de trace technique ni de chemin de fichier
app.use((req, res) => {
  res.status(404).type('text').send('Page introuvable.');
});
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  res.status(500).type('text').send('Erreur du serveur.');
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Heritage en ligne sur http://localhost:${PORT}`));

  if (adminInitial) {
    // Affiché une seule fois : seul son hachage bcrypt est gardé en base
    console.log('');
    console.log('=== Administration : compte créé ===');
    console.log(`Adresse      : http://localhost:${PORT}/admin/`);
    console.log(`Identifiant  : ${adminInitial.identifiant}`);
    console.log(`Mot de passe : ${adminInitial.motDePasse}`);
    console.log(adminInitial.doitChanger
      ? 'Ce mot de passe est temporaire : il vous sera demandé de le changer à la première connexion.'
      : 'Mot de passe pris dans ADMIN_INITIAL_PASSWORD.');
    if (adminInitial.avertissement) console.warn(adminInitial.avertissement);
    console.log('Notez-le maintenant : il ne sera plus jamais affiché.');
    console.log('===================================');
    console.log('');
  }

  if (modeTest()) {
    console.log('Emails en MODE TEST : les commandes sont écrites dans le dossier outbox/ (définir SMTP_HOST pour envoyer pour de vrai).');
  } else if (!process.env.ADMIN_EMAIL) {
    console.warn('ADMIN_EMAIL n’est pas défini : les commandes seront envoyées à une adresse par défaut inexistante.');
  }
  // Nouvel essai toutes les 2 minutes pour les emails qui ne sont pas partis
  setInterval(() => orders.reessayerEnvois().catch((e) => console.error(e.message)), 2 * 60 * 1000).unref();
  // Ménage des sessions expirées toutes les heures
  setInterval(() => admin.auth.nettoyerSessions(), 60 * 60 * 1000).unref();
}

module.exports = app;
