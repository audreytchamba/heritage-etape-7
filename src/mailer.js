// Envoi de l'email "nouvelle commande" à l'administrateur avec Nodemailer.
//
// Réglages par variables d'environnement (aucun secret dans le code) :
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE (true/false), SMTP_USER, SMTP_PASS
//   MAIL_FROM   ex. "Heritage <commandes@votre-domaine.com>"
//   ADMIN_EMAIL adresse qui reçoit les commandes
//   OUTBOX_DIR  dossier du mode test (par défaut ./outbox)
//
// Sans SMTP_HOST, on est en MODE TEST : aucun email ne part, chaque message est
// écrit dans le dossier outbox/ au format .eml (ouvrable avec un client mail).
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { formatHeure, enMinutes } = require('./validation');

const prix = (n) => `${new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ')} FCFA`;

const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function modeTest() {
  return !process.env.SMTP_HOST;
}

function creerTransport() {
  if (modeTest()) {
    return nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
}

function libelleJour(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j)).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

// commande : { reference, nom, tel, date, heure, total, lignes: [{ name, unitPrice, qty }] }
function composer(commande) {
  const quand = `${libelleJour(commande.date)} à ${formatHeure(enMinutes(commande.heure))}`;
  // Le sujet n'utilise que des valeurs contrôlées (référence, total, date), jamais le nom du client.
  const sujet = `Nouvelle commande ${commande.reference} : ${prix(commande.total)} pour le ${commande.date} à ${commande.heure}`;

  const lignesTexte = commande.lignes.map((l) => `- ${l.qty} x ${l.name} (${prix(l.unitPrice * l.qty)})`);
  const texte = [
    `Nouvelle commande ${commande.reference}`,
    '',
    ...lignesTexte,
    `Total : ${prix(commande.total)}`,
    '',
    `Client : ${commande.nom}`,
    `Téléphone : ${commande.tel}`,
    `Pour le : ${quand}`,
    '',
    'Rappelez le client pour confirmer la commande.',
  ].join('\n');

  const lignesHtml = commande.lignes.map((l) => (
    `<tr><td style="padding:6px 12px 6px 0">${l.qty} &times; ${echapper(l.name)}</td>` +
    `<td style="padding:6px 0;text-align:right">${echapper(prix(l.unitPrice * l.qty))}</td></tr>`
  )).join('');
  const html = [
    `<div style="font-family:Arial,sans-serif;color:#1f1530;max-width:520px">`,
    `<h2 style="margin:0 0 12px">Nouvelle commande ${echapper(commande.reference)}</h2>`,
    `<table style="width:100%;border-collapse:collapse;border-top:2px solid #1f1530">${lignesHtml}`,
    `<tr><td style="padding:10px 0;border-top:1px solid #d9d1e2"><strong>Total</strong></td>`,
    `<td style="padding:10px 0;border-top:1px solid #d9d1e2;text-align:right"><strong>${echapper(prix(commande.total))}</strong></td></tr></table>`,
    `<p><strong>Client :</strong> ${echapper(commande.nom)}<br>`,
    `<strong>Téléphone :</strong> <a href="tel:${echapper(commande.tel.replace(/\s/g, ''))}">${echapper(commande.tel)}</a><br>`,
    `<strong>Pour le :</strong> ${echapper(quand)}</p>`,
    `<p>Rappelez le client pour confirmer la commande.</p>`,
    `</div>`,
  ].join('');

  return { sujet, texte, html };
}

function creerMailer() {
  const transport = creerTransport();
  const admin = process.env.ADMIN_EMAIL || 'admin@heritage.local';
  const from = process.env.MAIL_FROM || 'Heritage <commandes@heritage.local>';
  const outbox = process.env.OUTBOX_DIR || path.join(__dirname, '..', 'outbox');

  return {
    modeTest: modeTest(),
    async envoyerCommande(commande) {
      const { sujet, texte, html } = composer(commande);
      const info = await transport.sendMail({ from, to: admin, subject: sujet, text: texte, html });
      if (modeTest()) {
        fs.mkdirSync(outbox, { recursive: true });
        fs.writeFileSync(path.join(outbox, `${commande.reference}.eml`), info.message);
      }
      return info;
    },
  };
}

module.exports = { creerMailer, composer, modeTest };
