// API de l'administration : /admin/api/*
// Règles : toute route (sauf session et login) exige une session valide ; toute écriture exige
// en plus le jeton CSRF ; les photos sont vérifiées par leur contenu, pas par ce que dit le client.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { creerAuth, validerMotDePasse, memeOrigine } = require('./auth');

const PRIX_MAX = 1000000;
const URL_PHOTO = /^\/uploads\/([a-f0-9]{32}\.(?:jpg|png|webp))$/;

// En-têtes de sécurité de toutes les pages et réponses de /admin
function entetesAdmin(req, res, next) {
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  });
  next();
}

// Détecte le vrai type d'une image à partir de ses premiers octets
function typeImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

const proprePhrase = (s) => s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();

function creerAdmin(db) {
  const auth = creerAuth(db);
  const router = express.Router();
  const dossier = config.admin.dossierPhotos;
  const protege = [auth.exigerConnexion, auth.exigerMotDePasseChange, auth.exigerCsrf];

  const dishSql = `SELECT id, name, description, price, category_id AS categoryId, photo_url AS photoUrl, available
                   FROM dishes`;
  const lirePlatBase = (id) => {
    const d = db.prepare(`${dishSql} WHERE id = ?`).get(id);
    return d ? { ...d, available: d.available === 1 } : null;
  };
  const idValide = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  function supprimerFichierPhoto(photoUrl) {
    const m = typeof photoUrl === 'string' ? photoUrl.match(URL_PHOTO) : null;
    if (!m) return; // illustration provisoire du site ou valeur inattendue : on ne touche à rien
    try { fs.unlinkSync(path.join(dossier, m[1])); } catch (e) { if (e.code !== 'ENOENT') console.error('Photo non supprimée :', e.message); }
  }

  /* ---------- Validation ---------- */

  function lirePlat(corps, { creation }) {
    const b = corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : {};
    const val = {};
    const erreurs = {};

    if (creation || 'name' in b) {
      const nom = typeof b.name === 'string' ? proprePhrase(b.name) : '';
      if (!nom) erreurs.name = 'Indiquez le nom du plat.';
      else if (nom.length > 80) erreurs.name = 'Le nom est trop long (80 caractères au maximum).';
      else val.name = nom;
    }
    if ('description' in b || creation) {
      const d = b.description === undefined ? '' : b.description;
      if (typeof d !== 'string') erreurs.description = 'Description non valide.';
      else if (proprePhrase(d).length > 300) erreurs.description = 'La description est trop longue (300 caractères au maximum).';
      else val.description = proprePhrase(d);
    }
    if (creation || 'price' in b) {
      if (!Number.isInteger(b.price) || b.price < 0 || b.price > PRIX_MAX) {
        erreurs.price = `Le prix doit être un nombre entier de francs CFA, entre 0 et ${PRIX_MAX}.`;
      } else val.price = b.price;
    }
    if (creation || 'categoryId' in b) {
      const c = Number.isInteger(b.categoryId) ? db.prepare('SELECT id FROM categories WHERE id = ?').get(b.categoryId) : null;
      if (!c) erreurs.categoryId = 'Choisissez une catégorie existante.';
      else val.category_id = b.categoryId;
    }
    if ('available' in b || creation) {
      const a = b.available === undefined ? true : b.available;
      if (typeof a !== 'boolean') erreurs.available = 'Disponibilité non valide.';
      else val.available = a ? 1 : 0;
    }
    return { val, erreurs };
  }

  function lireNomCategorie(corps) {
    const nom = corps && typeof corps.name === 'string' ? proprePhrase(corps.name) : '';
    if (!nom) return { erreur: 'Indiquez le nom de la catégorie.' };
    if (nom.length > 40) return { erreur: 'Le nom est trop long (40 caractères au maximum).' };
    return { nom };
  }

  /* ---------- Session ---------- */

  router.use(auth.chargerSession);

  router.get('/session', (req, res) => {
    if (!req.admin) return res.json({ connecte: false });
    return res.json({
      connecte: true,
      identifiant: req.admin.identifiant,
      csrf: req.admin.csrf,
      doitChangerMotDePasse: req.admin.doitChanger,
    });
  });

  router.post('/login', async (req, res) => {
    if (!memeOrigine(req)) return res.status(403).json({ erreur: 'Requête refusée.' });
    const attente = auth.limiteur.attente(req.ip);
    if (attente > 0) {
      res.set('Retry-After', String(Math.ceil(attente / 1000)));
      return res.status(429).json({ erreur: `Trop de tentatives. Réessayez dans ${Math.ceil(attente / 60000)} minute(s).` });
    }
    const { identifiant, motDePasse } = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof identifiant !== 'string' || typeof motDePasse !== 'string' || identifiant.length > 100 || motDePasse.length > 200) {
      return res.status(400).json({ erreur: 'Renseignez l’identifiant et le mot de passe.' });
    }
    if (!(await auth.verifierIdentifiants(identifiant, motDePasse))) {
      auth.limiteur.echec(req.ip);
      console.warn(`Connexion admin refusée (adresse ${req.ip})`);
      return res.status(401).json({ erreur: 'Identifiant ou mot de passe incorrect.' });
    }
    auth.limiteur.succes(req.ip);
    if (req.admin) auth.detruireSession(req.admin.idHash); // nouvelle session à chaque connexion
    const s = auth.creerSession(req, res);
    auth.nettoyerSessions();
    const doitChanger = db.prepare('SELECT must_change FROM admin WHERE id = 1').get().must_change === 1;
    return res.json({ ok: true, csrf: s.csrf, doitChangerMotDePasse: doitChanger });
  });

  router.post('/logout', auth.exigerConnexion, auth.exigerCsrf, (req, res) => {
    auth.detruireSession(req.admin.idHash);
    res.clearCookie('heritage_admin', { path: '/admin' });
    res.json({ ok: true });
  });

  router.post('/mot-de-passe', auth.exigerConnexion, auth.exigerCsrf, async (req, res) => {
    const attente = auth.limiteur.attente(req.ip);
    if (attente > 0) {
      res.set('Retry-After', String(Math.ceil(attente / 1000)));
      return res.status(429).json({ erreur: `Trop de tentatives. Réessayez dans ${Math.ceil(attente / 60000)} minute(s).` });
    }
    const { actuel, nouveau } = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof actuel !== 'string' || typeof nouveau !== 'string') return res.status(400).json({ erreurs: { nouveau: 'Renseignez les deux mots de passe.' } });
    if (!(await auth.verifierMotDePasseActuel(actuel))) {
      auth.limiteur.echec(req.ip);
      return res.status(400).json({ erreurs: { actuel: 'Le mot de passe actuel est incorrect.' } });
    }
    const v = validerMotDePasse(nouveau, req.admin.identifiant, actuel);
    if (!v.ok) return res.status(400).json({ erreurs: { nouveau: v.erreur } });
    await auth.changerMotDePasse(nouveau, req.admin.idHash);
    auth.limiteur.succes(req.ip);
    return res.json({ ok: true });
  });

  /* ---------- Plats ---------- */

  router.get('/plats', protege, (req, res) => {
    const plats = db.prepare(`${dishSql} ORDER BY category_id, id`).all().map((d) => ({ ...d, available: d.available === 1 }));
    const categories = db.prepare(
      `SELECT c.id, c.name, (SELECT COUNT(*) FROM dishes d WHERE d.category_id = c.id) AS nbPlats FROM categories c ORDER BY c.id`
    ).all();
    res.json({ plats, categories });
  });

  router.post('/plats', protege, (req, res) => {
    const { val, erreurs } = lirePlat(req.body, { creation: true });
    if (Object.keys(erreurs).length) return res.status(400).json({ erreurs });
    const r = db.prepare('INSERT INTO dishes (name, description, price, category_id, photo_url, available) VALUES (?, ?, ?, ?, NULL, ?)')
      .run(val.name, val.description, val.price, val.category_id, val.available);
    return res.status(201).json(lirePlatBase(r.lastInsertRowid));
  });

  router.put('/plats/:id', protege, (req, res) => {
    const id = idValide(req.params.id);
    if (!id || !lirePlatBase(id)) return res.status(404).json({ erreur: 'Plat introuvable.' });
    const { val, erreurs } = lirePlat(req.body, { creation: false });
    if (Object.keys(erreurs).length) return res.status(400).json({ erreurs });
    const colonnes = Object.keys(val); // uniquement des colonnes issues de la liste blanche de lirePlat
    if (!colonnes.length) return res.status(400).json({ erreur: 'Aucune modification reçue.' });
    db.prepare(`UPDATE dishes SET ${colonnes.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...colonnes.map((c) => val[c]), id);
    return res.json(lirePlatBase(id));
  });

  router.delete('/plats/:id', protege, (req, res) => {
    const id = idValide(req.params.id);
    const plat = id ? lirePlatBase(id) : null;
    if (!plat) return res.status(404).json({ erreur: 'Plat introuvable.' });
    db.prepare('DELETE FROM dishes WHERE id = ?').run(id);
    supprimerFichierPhoto(plat.photoUrl);
    return res.json({ ok: true });
  });

  router.put(
    '/plats/:id/photo',
    protege,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: config.admin.photoMaxOctets }),
    (req, res) => {
      const id = idValide(req.params.id);
      const plat = id ? lirePlatBase(id) : null;
      if (!plat) return res.status(404).json({ erreur: 'Plat introuvable.' });
      if (!Buffer.isBuffer(req.body)) return res.status(415).json({ erreur: 'Envoyez une image JPEG, PNG ou WebP.' });
      const type = typeImage(req.body);
      if (!type || type.mime !== req.get('content-type').split(';')[0].trim()) {
        return res.status(415).json({ erreur: 'Ce fichier n’est pas une image JPEG, PNG ou WebP valide.' });
      }
      fs.mkdirSync(dossier, { recursive: true });
      const nom = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`;
      fs.writeFileSync(path.join(dossier, nom), req.body, { flag: 'wx', mode: 0o644 });
      try {
        db.prepare('UPDATE dishes SET photo_url = ? WHERE id = ?').run(`/uploads/${nom}`, id);
      } catch (e) {
        fs.unlinkSync(path.join(dossier, nom));
        throw e;
      }
      supprimerFichierPhoto(plat.photoUrl);
      return res.json({ photoUrl: `/uploads/${nom}` });
    }
  );

  router.delete('/plats/:id/photo', protege, (req, res) => {
    const id = idValide(req.params.id);
    const plat = id ? lirePlatBase(id) : null;
    if (!plat) return res.status(404).json({ erreur: 'Plat introuvable.' });
    db.prepare('UPDATE dishes SET photo_url = NULL WHERE id = ?').run(id);
    supprimerFichierPhoto(plat.photoUrl);
    return res.json({ ok: true });
  });

  /* ---------- Catégories ---------- */

  const doublon = (nom, saufId) =>
    db.prepare('SELECT id FROM categories WHERE lower(name) = lower(?) AND id <> ?').get(nom, saufId || 0);

  router.post('/categories', protege, (req, res) => {
    const r = lireNomCategorie(req.body);
    if (r.erreur) return res.status(400).json({ erreurs: { name: r.erreur } });
    if (doublon(r.nom)) return res.status(409).json({ erreurs: { name: 'Une catégorie porte déjà ce nom.' } });
    const ins = db.prepare('INSERT INTO categories (name) VALUES (?)').run(r.nom);
    return res.status(201).json({ id: Number(ins.lastInsertRowid), name: r.nom, nbPlats: 0 });
  });

  router.put('/categories/:id', protege, (req, res) => {
    const id = idValide(req.params.id);
    const existe = id ? db.prepare('SELECT id FROM categories WHERE id = ?').get(id) : null;
    if (!existe) return res.status(404).json({ erreur: 'Catégorie introuvable.' });
    const r = lireNomCategorie(req.body);
    if (r.erreur) return res.status(400).json({ erreurs: { name: r.erreur } });
    if (doublon(r.nom, id)) return res.status(409).json({ erreurs: { name: 'Une catégorie porte déjà ce nom.' } });
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(r.nom, id);
    return res.json({ id, name: r.nom });
  });

  router.delete('/categories/:id', protege, (req, res) => {
    const id = idValide(req.params.id);
    const existe = id ? db.prepare('SELECT id FROM categories WHERE id = ?').get(id) : null;
    if (!existe) return res.status(404).json({ erreur: 'Catégorie introuvable.' });
    const n = db.prepare('SELECT COUNT(*) AS n FROM dishes WHERE category_id = ?').get(id).n;
    if (n > 0) {
      return res.status(409).json({ erreur: `Cette catégorie contient ${n} plat${n > 1 ? 's' : ''}. Déplacez-les ou supprimez-les d’abord.` });
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return res.json({ ok: true });
  });

  /* ---------- Commandes (lecture seule) ---------- */

  router.get('/commandes', protege, (req, res) => {
    const commandes = db.prepare(
      `SELECT id, reference, customer_name AS nom, phone AS tel, requested_for AS pour, total, status,
              email_sent AS emailEnvoye, created_at AS creeLe
       FROM orders ORDER BY id DESC LIMIT 50`
    ).all();
    if (commandes.length) {
      const lignes = db.prepare(
        `SELECT order_id AS commandeId, name, unit_price AS prixUnitaire, qty FROM order_items
         WHERE order_id IN (${commandes.map(() => '?').join(',')}) ORDER BY id`
      ).all(...commandes.map((c) => c.id));
      commandes.forEach((c) => {
        c.emailEnvoye = c.emailEnvoye === 1;
        c.lignes = lignes.filter((l) => l.commandeId === c.id).map(({ name, prixUnitaire, qty }) => ({ name, prixUnitaire, qty }));
      });
    }
    res.json({ commandes });
  });

  return { router, auth };
}

module.exports = { creerAdmin, entetesAdmin, typeImage };
