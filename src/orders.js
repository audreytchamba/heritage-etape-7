// POST /api/commandes : enregistre la commande, recalcule le total côté serveur,
// prévient l'administrateur par email. Rien de ce que le navigateur envoie n'est cru
// sans vérification : prix, noms et disponibilité viennent de la base.
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const v = require('./validation');
const { creerMailer } = require('./mailer');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I/L pour éviter les confusions
const TENTATIVES_MAX = 5;

function nouvelleReference() {
  let s = '';
  for (let i = 0; i < 6; i += 1) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `HER-${s}`;
}

// Limitation simple en mémoire : N requêtes par fenêtre de temps et par adresse IP.
function creerLimiteur({ fenetreMs, max }) {
  const parIp = new Map();
  return function depasse(ip) {
    const maintenant = Date.now();
    const recents = (parIp.get(ip) || []).filter((t) => maintenant - t < fenetreMs);
    recents.push(maintenant);
    parIp.set(ip, recents);
    if (parIp.size > 5000) { // garde-fou mémoire
      for (const [k, ts] of parIp) if (!ts.some((t) => maintenant - t < fenetreMs)) parIp.delete(k);
    }
    return recents.length > max;
  };
}

function creerOrders(db, mailer = creerMailer()) {
  const router = express.Router();
  const depasse = creerLimiteur(config.limiteCommandes);

  const insererCommande = db.prepare(
    `INSERT INTO orders (reference, customer_name, phone, requested_for, total) VALUES (?, ?, ?, ?, ?)`
  );
  const insererLigne = db.prepare(
    `INSERT INTO order_items (order_id, dish_id, name, unit_price, qty) VALUES (?, ?, ?, ?, ?)`
  );
  const marquerEnvoye = db.prepare(`UPDATE orders SET email_sent = 1, email_attempts = email_attempts + 1 WHERE id = ?`);
  const marquerEchec = db.prepare(`UPDATE orders SET email_attempts = email_attempts + 1 WHERE id = ?`);
  const lignesDe = db.prepare(`SELECT name, unit_price AS unitPrice, qty FROM order_items WHERE order_id = ? ORDER BY id`);

  function versCommandeMail(o) {
    const [date, heure] = o.requested_for.split('T');
    return {
      reference: o.reference, nom: o.customer_name, tel: o.phone, date, heure, total: o.total,
      lignes: lignesDe.all(o.id),
    };
  }

  async function notifier(o) {
    try {
      await mailer.envoyerCommande(versCommandeMail(o));
      marquerEnvoye.run(o.id);
      return true;
    } catch (e) {
      marquerEchec.run(o.id);
      console.error(`Email non envoyé pour ${o.reference} :`, e.message);
      return false;
    }
  }

  // Nouvel essai pour les commandes dont l'email n'est pas parti (SMTP en panne, etc.)
  async function reessayerEnvois() {
    const aRelancer = db.prepare(
      `SELECT * FROM orders
       WHERE email_sent = 0 AND email_attempts < ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
       ORDER BY id LIMIT 20`
    ).all(TENTATIVES_MAX);
    for (const o of aRelancer) await notifier(o);
    return aRelancer.length;
  }

  router.post('/api/commandes', async (req, res) => {
    if (depasse(req.ip)) {
      return res.status(429).json({ erreur: 'Trop de commandes envoyées depuis cette connexion. Réessayez dans quelques minutes.' });
    }

    const corps = req.body && typeof req.body === 'object' ? req.body : {};

    // Champ piège invisible pour les humains : un robot le remplit. On répond comme si tout allait bien.
    if (typeof corps.site === 'string' && corps.site.trim() !== '') {
      console.warn('Commande ignorée (champ piège rempli)');
      return res.status(201).json({ ok: true, reference: nouvelleReference(), total: 0, notifie: true });
    }

    const now = v.maintenant();
    const rNom = v.validerNom(corps.nom);
    const rTel = v.validerTel(corps.tel);
    const rDate = v.validerDate(corps.date, now);
    const rHeure = rDate.erreur ? { erreur: 'Choisissez d’abord un jour valide.' } : v.validerHeure(corps.date, corps.heure, now);
    const rLignes = v.validerLignes(corps.lignes);

    const erreurs = {};
    [['nom', rNom], ['tel', rTel], ['date', rDate], ['heure', rHeure], ['lignes', rLignes]].forEach(([k, r]) => {
      if (r.erreur) erreurs[k] = r.erreur;
    });
    if (Object.keys(erreurs).length) return res.status(400).json({ erreurs });

    // Prix, noms et disponibilité : toujours relus en base, jamais pris dans la requête
    const ids = rLignes.valeur.map((l) => l.id);
    const plats = db
      .prepare(`SELECT id, name, price, available FROM dishes WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids);
    const parId = new Map(plats.map((p) => [p.id, p]));
    for (const l of rLignes.valeur) {
      const p = parId.get(l.id);
      if (!p) return res.status(400).json({ erreurs: { lignes: 'Un plat de votre panier n’existe plus au menu.' } });
      if (!p.available) return res.status(400).json({ erreurs: { lignes: `« ${p.name} » n’est plus disponible.` } });
    }
    const total = rLignes.valeur.reduce((s, l) => s + parId.get(l.id).price * l.qty, 0);

    let commande;
    const enregistrer = db.transaction(() => {
      for (let essai = 0; essai < 5; essai += 1) {
        const reference = nouvelleReference();
        try {
          const r = insererCommande.run(reference, rNom.valeur, rTel.valeur, `${rDate.valeur}T${rHeure.valeur}`, total);
          rLignes.valeur.forEach((l) => {
            const p = parId.get(l.id);
            insererLigne.run(r.lastInsertRowid, p.id, p.name, p.price, l.qty);
          });
          return db.prepare('SELECT * FROM orders WHERE id = ?').get(r.lastInsertRowid);
        } catch (e) {
          if (!String(e.message).includes('UNIQUE')) throw e; // référence déjà prise : on retente
        }
      }
      throw new Error('Impossible de générer une référence unique');
    });

    try {
      commande = enregistrer();
    } catch (e) {
      console.error('Enregistrement de la commande impossible :', e.message);
      return res.status(500).json({ erreur: 'La commande n’a pas pu être enregistrée. Réessayez, ou commandez par WhatsApp.' });
    }

    const notifie = await notifier(commande);
    return res.status(201).json({ ok: true, reference: commande.reference, total, notifie });
  });

  return { router, reessayerEnvois };
}

module.exports = { creerOrders };
