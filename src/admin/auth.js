// Authentification de l'administration : un seul compte, sessions côté serveur.
//
//  - Mot de passe : haché avec bcrypt (bcryptjs), jamais stocké ni journalisé en clair.
//  - Session : cookie aléatoire de 256 bits (HttpOnly, SameSite=Strict, limité à /admin).
//    La base ne garde que son SHA-256 : une fuite de la base ne donne aucune session valide.
//  - CSRF : jeton propre à chaque session, exigé dans l'en-tête X-CSRF-Token pour toute écriture,
//    en plus d'un contrôle de l'en-tête Origin.
//  - Tentatives de connexion : limitées par adresse IP, et au total sur toute l'application.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

const COOKIE = 'heritage_admin';
// Sans I, O, l, 0, 1 : on ne confond rien en recopiant le mot de passe temporaire
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const MOTS_DE_PASSE_COURANTS = ['motdepasse', 'motdepasse123', 'administrateur', 'heritage', 'heritagebastos', 'azertyuiop', 'azertyuiop123', 'password', 'password123'];

function genererMotDePasse() {
  let s = '';
  for (let i = 0; i < 16; i += 1) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s; // 16 caractères parmi 54 : environ 92 bits
}

// Refuse les requêtes d'écriture venant d'un autre site. Sans en-tête Origin (outils, anciens navigateurs),
// le jeton CSRF et le cookie SameSite=Strict restent exigés.
function memeOrigine(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === req.get('host'); } catch (e) { return false; }
}

// -> { ok: true } ou { ok: false, erreur }
function validerMotDePasse(nouveau, identifiant = '', actuel = '') {
  const refus = (erreur) => ({ ok: false, erreur });
  if (typeof nouveau !== 'string') return refus('Entrez un mot de passe.');
  const min = config.admin.motDePasseMin;
  if (nouveau.length < min) return refus(`Le mot de passe doit contenir au moins ${min} caractères.`);
  // bcrypt ne lit que les 72 premiers octets : au-delà, deux mots de passe différents seraient équivalents
  if (Buffer.byteLength(nouveau, 'utf8') > 72) return refus('Le mot de passe est trop long (72 caractères au maximum).');
  if (identifiant && nouveau.toLowerCase().includes(String(identifiant).toLowerCase())) return refus('Le mot de passe ne doit pas contenir votre identifiant.');
  if (actuel && nouveau === actuel) return refus('Le nouveau mot de passe doit être différent de l’actuel.');
  const simple = new Set(nouveau).size < 5 || /^\d+$/.test(nouveau);
  const courant = MOTS_DE_PASSE_COURANTS.includes(nouveau.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (simple || courant) return refus('Ce mot de passe est trop facile à deviner. Mélangez lettres, chiffres et signes.');
  return { ok: true };
}

const empreinte = (jeton) => crypto.createHash('sha256').update(jeton).digest('hex');

function lireCookie(req) {
  const brut = req.headers.cookie;
  if (!brut) return null;
  for (const morceau of brut.split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0 && morceau.slice(0, i).trim() === COOKIE) {
      try { return decodeURIComponent(morceau.slice(i + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}

function creerAuth(db) {
  const cfg = config.admin;

  /* ---------- Limitation des tentatives échouées ---------- */
  const fenetre = cfg.tentatives.fenetreMs;
  const parIp = new Map(); // ip -> horodatages des échecs
  let globaux = [];
  const recents = (liste) => { const t = Date.now(); return liste.filter((x) => t - x < fenetre); };

  const limiteur = {
    // Millisecondes à attendre avant de pouvoir réessayer (0 = autorisé)
    attente(ip) {
      const l = recents(parIp.get(ip) || []);
      if (l.length) parIp.set(ip, l); else parIp.delete(ip);
      globaux = recents(globaux);
      let a = 0;
      if (l.length >= cfg.tentatives.parIp) a = Math.max(a, fenetre - (Date.now() - l[0]));
      if (globaux.length >= cfg.tentatives.global) a = Math.max(a, fenetre - (Date.now() - globaux[0]));
      return a;
    },
    echec(ip) {
      const l = recents(parIp.get(ip) || []);
      l.push(Date.now());
      parIp.set(ip, l);
      globaux.push(Date.now());
      if (parIp.size > 5000) for (const [k, v] of parIp) if (!recents(v).length) parIp.delete(k); // garde-fou mémoire
    },
    succes(ip) { parIp.delete(ip); },
  };

  /* ---------- Compte ---------- */
  let hashFactice = null; // sert à dépenser le même temps de calcul quand l'identifiant est faux
  const factice = () => { if (!hashFactice) hashFactice = bcrypt.hashSync('mot-de-passe-factice', cfg.bcryptCost); return hashFactice; };
  const lireCompte = () => db.prepare('SELECT username, password_hash, must_change FROM admin WHERE id = 1').get();

  async function verifierIdentifiants(identifiant, motDePasse) {
    const a = lireCompte();
    const idOk = !!a && identifiant.toLowerCase() === a.username.toLowerCase();
    const mdpOk = await bcrypt.compare(motDePasse, idOk ? a.password_hash : factice()); // un seul calcul bcrypt dans tous les cas
    return idOk && mdpOk;
  }

  async function verifierMotDePasseActuel(actuel) {
    const a = lireCompte();
    return bcrypt.compare(actuel, a ? a.password_hash : factice()).then((ok) => !!a && ok);
  }

  // Remplace le mot de passe et ferme toutes les autres sessions (seule la session courante reste ouverte)
  async function changerMotDePasse(nouveau, idHashCourant) {
    const hash = await bcrypt.hash(nouveau, cfg.bcryptCost);
    db.prepare("UPDATE admin SET password_hash = ?, must_change = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1").run(hash);
    db.prepare('DELETE FROM sessions WHERE id_hash <> ?').run(idHashCourant);
  }

  // Au premier démarrage : crée le compte. Renvoie le mot de passe à afficher UNE fois, ou null si le compte existe déjà.
  function initialiserAdmin() {
    if (db.prepare('SELECT 1 FROM admin WHERE id = 1').get()) return null;
    const identifiant = cfg.identifiant;
    let motDePasse = process.env.ADMIN_INITIAL_PASSWORD || null;
    let doitChanger = false;
    let avertissement;
    if (motDePasse) {
      const v = validerMotDePasse(motDePasse, identifiant);
      if (!v.ok) {
        avertissement = `ADMIN_INITIAL_PASSWORD refusé (${v.erreur}) : un mot de passe temporaire a été généré à la place.`;
        motDePasse = null;
      }
    }
    if (!motDePasse) { motDePasse = genererMotDePasse(); doitChanger = true; }
    db.prepare('INSERT INTO admin (id, username, password_hash, must_change) VALUES (1, ?, ?, ?)')
      .run(identifiant, bcrypt.hashSync(motDePasse, cfg.bcryptCost), doitChanger ? 1 : 0);
    return { identifiant, motDePasse, doitChanger, avertissement };
  }

  // Mot de passe oublié (npm run admin:reset) : nouveau mot de passe temporaire, toutes les sessions fermées
  function reinitialiserMotDePasse() {
    const motDePasse = genererMotDePasse();
    const hash = bcrypt.hashSync(motDePasse, cfg.bcryptCost);
    const existe = db.prepare('SELECT 1 FROM admin WHERE id = 1').get();
    if (existe) {
      db.prepare("UPDATE admin SET password_hash = ?, must_change = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1").run(hash);
    } else {
      db.prepare('INSERT INTO admin (id, username, password_hash, must_change) VALUES (1, ?, ?, 1)').run(cfg.identifiant, hash);
    }
    db.prepare('DELETE FROM sessions').run();
    return { identifiant: db.prepare('SELECT username FROM admin WHERE id = 1').get().username, motDePasse };
  }

  /* ---------- Sessions ---------- */
  function creerSession(req, res) {
    const jeton = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    const t = Date.now();
    db.prepare('INSERT INTO sessions (id_hash, csrf, created_at, last_seen) VALUES (?, ?, ?, ?)').run(empreinte(jeton), csrf, t, t);
    res.cookie(COOKIE, jeton, {
      httpOnly: true,          // illisible par JavaScript
      sameSite: 'strict',      // jamais envoyé depuis un autre site
      path: '/admin',          // ne part pas vers le site public
      maxAge: cfg.dureeMaxMs,
      secure: req.secure || process.env.NODE_ENV === 'production',
    });
    return { csrf };
  }

  const detruireSession = (idHash) => { db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash); };

  function nettoyerSessions() {
    const t = Date.now();
    db.prepare('DELETE FROM sessions WHERE last_seen < ? OR created_at < ?').run(t - cfg.inactiviteMs, t - cfg.dureeMaxMs);
  }

  // Lit le cookie et renseigne req.admin (ou null). Ne refuse rien : voir exigerConnexion.
  function chargerSession(req, res, next) {
    req.admin = null;
    const jeton = lireCookie(req);
    if (jeton && jeton.length >= 20 && jeton.length <= 100) {
      const idHash = empreinte(jeton);
      const s = db.prepare('SELECT csrf, created_at, last_seen FROM sessions WHERE id_hash = ?').get(idHash);
      const compte = s && lireCompte();
      if (s && compte) {
        const t = Date.now();
        if (t - s.last_seen > cfg.inactiviteMs || t - s.created_at > cfg.dureeMaxMs) {
          detruireSession(idHash);
        } else {
          if (t - s.last_seen > 30000) db.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?').run(t, idHash);
          req.admin = { idHash, csrf: s.csrf, identifiant: compte.username, doitChanger: compte.must_change === 1 };
        }
      }
    }
    next();
  }

  const exigerConnexion = (req, res, next) => {
    if (!req.admin) return res.status(401).json({ erreur: 'Votre session a expiré. Reconnectez-vous.', code: 'connexion_requise' });
    return next();
  };

  // Tant que le mot de passe temporaire n'a pas été remplacé, rien d'autre n'est permis
  const exigerMotDePasseChange = (req, res, next) => {
    if (req.admin.doitChanger) {
      return res.status(403).json({ erreur: 'Choisissez d’abord votre propre mot de passe.', code: 'changer_mot_de_passe' });
    }
    return next();
  };

  const exigerCsrf = (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (!memeOrigine(req)) return res.status(403).json({ erreur: 'Requête refusée.', code: 'origine' });
    const recu = Buffer.from(String(req.get('x-csrf-token') || ''));
    const attendu = Buffer.from(req.admin.csrf);
    if (recu.length !== attendu.length || !crypto.timingSafeEqual(recu, attendu)) {
      return res.status(403).json({ erreur: 'Requête refusée. Rechargez la page et réessayez.', code: 'csrf' });
    }
    return next();
  };

  return {
    limiteur, verifierIdentifiants, verifierMotDePasseActuel, changerMotDePasse, initialiserAdmin, reinitialiserMotDePasse,
    creerSession, detruireSession, nettoyerSessions, chargerSession, exigerConnexion, exigerMotDePasseChange, exigerCsrf,
  };
}

module.exports = { creerAuth, validerMotDePasse, memeOrigine, genererMotDePasse, COOKIE };
