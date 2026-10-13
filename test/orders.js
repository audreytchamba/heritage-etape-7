// Tests de la commande par email (étape 5). Lancer : node test/orders.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { SMTPServer } = require('smtp-server');

process.env.DB_FILE = ':memory:';
process.env.OUTBOX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'heritage-outbox-'));
process.env.ORDER_RATE_MAX = '1000';
delete process.env.SMTP_HOST;

const db = require('../src/db');
const config = require('../src/config');
const v = require('../src/validation');
const { creerOrders } = require('../src/orders');
const { creerMailer, composer } = require('../src/mailer');
const app = require('../src/server');

let nb = 0;
function ok(nom) { nb += 1; console.log(`  ok  ${nom}`); }

function demarrer(a) {
  return new Promise((resolve) => {
    const s = a.listen(0, () => resolve({ url: `http://localhost:${s.address().port}`, close: () => new Promise((r) => s.close(r)) }));
  });
}
function appIsolee(orders) {
  const a = express();
  a.use(express.json({ limit: '10kb' }));
  a.use(orders.router);
  return a;
}
async function post(url, corps, brut) {
  const r = await fetch(`${url}/api/commandes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: brut !== undefined ? brut : JSON.stringify(corps),
  });
  let json = null;
  try { json = await r.json(); } catch (e) { /* pas de JSON */ }
  return { status: r.status, json };
}

// Un mercredi à au moins 2 jours d'ici, à 19h30 (restaurant ouvert)
function prochainMercredi() {
  const [a, m, j] = v.maintenant().iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + 2));
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const DATE = prochainMercredi();
const valide = (extra = {}) => ({
  nom: 'Awa Ngono', tel: '659 855 617', date: DATE, heure: '19:30',
  lignes: [{ id: 1, qty: 2 }, { id: 13, qty: 1 }], ...extra,
});
const nbCommandes = () => db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
const idPlat = (nom) => db.prepare('SELECT id FROM dishes WHERE name = ?').get(nom).id;

async function main() {
  const serveur = await demarrer(app);

  console.log('Commande valide');
  {
    const r = await post(serveur.url, valide({ total: 1, price: 1, lignes: [{ id: 1, qty: 2, price: 1 }, { id: 13, qty: 1, price: 1 }] }));
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.ok, true);
    assert.match(r.json.reference, /^HER-[A-HJKMNP-Z2-9]{6}$/);
    assert.strictEqual(r.json.total, 13500, 'le total doit venir de la base, pas de la requête');
    assert.strictEqual(r.json.notifie, true);
    ok('201, référence, total recalculé (prix et total envoyés par le client ignorés)');

    const o = db.prepare('SELECT * FROM orders WHERE reference = ?').get(r.json.reference);
    assert.strictEqual(o.customer_name, 'Awa Ngono');
    assert.strictEqual(o.phone, '+237 6 59 85 56 17');
    assert.strictEqual(o.requested_for, `${DATE}T19:30`);
    assert.strictEqual(o.total, 13500);
    assert.strictEqual(o.email_sent, 1);
    const items = db.prepare('SELECT name, unit_price, qty FROM order_items WHERE order_id = ? ORDER BY id').all(o.id);
    assert.deepStrictEqual(items, [{ name: 'Poulet braisé', unit_price: 6500, qty: 2 }, { name: 'Eau minérale', unit_price: 500, qty: 1 }]);
    ok('commande et lignes enregistrées avec les prix de la base');

    const eml = fs.readFileSync(path.join(process.env.OUTBOX_DIR, `${r.json.reference}.eml`), 'utf8');
    assert.match(eml, /^Subject: .*Nouvelle_commande_HER-/m); // sujet encodé en MIME (Q-encoding)
    assert.ok(eml.includes('admin@heritage.local'));
    ok('email écrit dans outbox/ (mode test)');
  }

  console.log('Validation serveur');
  {
    const avant = nbCommandes();
    let r = await post(serveur.url, {});
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(Object.keys(r.json.erreurs).sort(), ['date', 'heure', 'lignes', 'nom', 'tel']);
    ok('corps vide : 5 erreurs');

    r = await post(serveur.url, valide({ tel: '12345' })); assert.ok(r.status === 400 && r.json.erreurs.tel); ok('téléphone invalide refusé');
    r = await post(serveur.url, valide({ nom: ' ' })); assert.ok(r.status === 400 && r.json.erreurs.nom); ok('nom vide refusé');
    r = await post(serveur.url, valide({ nom: 'A'.repeat(81) })); assert.ok(r.status === 400 && r.json.erreurs.nom); ok('nom trop long refusé');
    r = await post(serveur.url, valide({ nom: ['x'] })); assert.ok(r.status === 400 && r.json.erreurs.nom); ok('nom de mauvais type refusé');
    r = await post(serveur.url, valide({ date: '2020-01-01' })); assert.ok(r.status === 400 && r.json.erreurs.date); ok('jour passé refusé');
    r = await post(serveur.url, valide({ date: '2026-02-30' })); assert.ok(r.status === 400 && r.json.erreurs.date); ok('date impossible refusée');
    r = await post(serveur.url, valide({ date: '2099-01-01' })); assert.ok(r.status === 400 && r.json.erreurs.date); ok('jour trop lointain refusé');
    r = await post(serveur.url, valide({ heure: '10:00' })); assert.ok(r.status === 400 && r.json.erreurs.heure); ok('heure de fermeture refusée');
    r = await post(serveur.url, valide({ heure: '25:99' })); assert.ok(r.status === 400 && r.json.erreurs.heure); ok('heure mal formée refusée');
    r = await post(serveur.url, valide({ lignes: [{ id: 1, qty: 0 }] })); assert.ok(r.status === 400 && r.json.erreurs.lignes); ok('quantité 0 refusée');
    r = await post(serveur.url, valide({ lignes: [{ id: 1, qty: 21 }] })); assert.ok(r.status === 400 && r.json.erreurs.lignes); ok('quantité 21 refusée');
    r = await post(serveur.url, valide({ lignes: [{ id: 1, qty: 15 }, { id: 1, qty: 15 }] })); assert.ok(r.status === 400 && r.json.erreurs.lignes); ok('doublons fusionnés puis plafonnés');
    r = await post(serveur.url, valide({ lignes: [{ id: '1', qty: 1 }] })); assert.ok(r.status === 400 && r.json.erreurs.lignes); ok('id de mauvais type refusé');
    r = await post(serveur.url, valide({ lignes: Array.from({ length: 31 }, (_, i) => ({ id: i + 1, qty: 1 })) })); assert.ok(r.status === 400 && r.json.erreurs.lignes); ok('plus de 30 lignes refusé');
    r = await post(serveur.url, valide({ lignes: [{ id: 9999, qty: 1 }] })); assert.ok(r.status === 400 && /n’existe plus/.test(r.json.erreurs.lignes)); ok('plat inconnu refusé');
    r = await post(serveur.url, valide({ lignes: [{ id: idPlat('Taro sauce jaune'), qty: 1 }] }));
    assert.ok(r.status === 400 && r.json.erreurs.lignes.includes('Taro sauce jaune')); ok('plat épuisé refusé');
    assert.strictEqual(nbCommandes(), avant, 'aucune commande ne doit être créée par une requête refusée');
    ok('aucune commande créée par les requêtes refusées');
  }

  console.log('Entrées hostiles');
  {
    const r = await post(serveur.url, valide({ nom: "x'); DROP TABLE orders;-- Bob" }));
    assert.strictEqual(r.status, 201);
    assert.ok(nbCommandes() >= 2, 'la table orders doit toujours exister');
    assert.strictEqual(db.prepare('SELECT customer_name AS n FROM orders WHERE reference = ?').get(r.json.reference).n, "x'); DROP TABLE orders;-- Bob");
    ok('injection SQL dans le nom : stockée telle quelle, table intacte');

    const r2 = await post(serveur.url, valide({ nom: 'Eve\r\nBcc: pirate@example.com\r\nSubject: spam' }));
    assert.strictEqual(r2.status, 201);
    const eml = fs.readFileSync(path.join(process.env.OUTBOX_DIR, `${r2.json.reference}.eml`), 'utf8');
    assert.ok(!/^Bcc:/mi.test(eml), 'un nom ne doit pas pouvoir ajouter un en-tête Bcc');
    assert.strictEqual((eml.match(/^Subject:/gm) || []).length, 1, 'un seul en-tête Subject');
    ok("injection d'en-têtes email par le nom : neutralisée");

    const mail = composer({
      reference: 'HER-TEST22', nom: '<script>alert(1)</script> Bob', tel: '+237 6 59 85 56 17', date: DATE, heure: '19:30', total: 500,
      lignes: [{ name: '<img src=x onerror=alert(1)>', unitPrice: 500, qty: 1 }],
    });
    assert.ok(!mail.html.includes('<script>') && !mail.html.includes('<img'));
    assert.ok(mail.html.includes('&lt;script&gt;') && mail.html.includes('&lt;img'));
    assert.ok(!mail.sujet.includes('Bob') && !mail.sujet.includes('<'));
    ok("HTML de l'email : noms échappés, sujet sans donnée client");

    const avant = nbCommandes();
    const piege = await post(serveur.url, valide({ site: 'http://spam.example' }));
    assert.strictEqual(piege.status, 201);
    assert.strictEqual(nbCommandes(), avant);
    ok('champ piège (robot) : fausse réussite, rien enregistré');

    let r3 = await post(serveur.url, null, '{pas du json');
    assert.strictEqual(r3.status, 400); assert.ok(r3.json && r3.json.erreur);
    ok('JSON mal formé : 400 en JSON');
    r3 = await post(serveur.url, null, JSON.stringify({ nom: 'x'.repeat(20000) }));
    assert.strictEqual(r3.status, 413); assert.ok(r3.json && r3.json.erreur);
    ok('corps de plus de 10 ko : 413');
  }

  console.log('Configuration publique');
  {
    const cfg = await (await fetch(`${serveur.url}/api/config`)).json();
    assert.deepStrictEqual(cfg.modesCommande, ['email', 'whatsapp']);
    assert.ok(!JSON.stringify(cfg).toLowerCase().includes('smtp') && !JSON.stringify(cfg).includes('ADMIN'));
    ok('/api/config expose les modes de commande, aucun réglage email');
  }
  await serveur.close();

  console.log('Limitation par IP');
  {
    const avant = config.limiteCommandes.max;
    config.limiteCommandes.max = 3;
    const mailerBidon = { envoyerCommande: async () => ({}) };
    const s = await demarrer(appIsolee(creerOrders(db, mailerBidon)));
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await post(s.url, valide())).status);
    assert.deepStrictEqual(codes, [201, 201, 201, 429, 429]);
    config.limiteCommandes.max = avant;
    await s.close();
    ok('4e requête dans la fenêtre : 429');
  }

  console.log('Email en échec puis nouvel essai');
  {
    let panne = true;
    const envoyes = [];
    const mailerCapricieux = { envoyerCommande: async (c) => { if (panne) throw new Error('SMTP en panne'); envoyes.push(c.reference); } };
    const orders = creerOrders(db, mailerCapricieux);
    const s = await demarrer(appIsolee(orders));
    const log = console.error; console.error = () => {};
    const r = await post(s.url, valide());
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.notifie, false, 'le client doit savoir que le restaurant n’a pas été prévenu');
    let o = db.prepare('SELECT * FROM orders WHERE reference = ?').get(r.json.reference);
    assert.strictEqual(o.email_sent, 0); assert.strictEqual(o.email_attempts, 1);
    ok('commande enregistrée même si l’email échoue, notifie=false');

    await orders.reessayerEnvois();
    o = db.prepare('SELECT * FROM orders WHERE reference = ?').get(r.json.reference);
    assert.strictEqual(o.email_sent, 0); assert.strictEqual(o.email_attempts, 2);
    panne = false;
    await orders.reessayerEnvois();
    console.error = log;
    o = db.prepare('SELECT * FROM orders WHERE reference = ?').get(r.json.reference);
    assert.strictEqual(o.email_sent, 1);
    assert.ok(envoyes.includes(r.json.reference));
    const n = envoyes.length;
    await orders.reessayerEnvois();
    assert.strictEqual(envoyes.length, n, 'une commande déjà notifiée ne doit pas être renvoyée');
    ok('le renvoi automatique envoie l’email dès que le SMTP remarche, sans doublon');
    await s.close();
  }

  console.log('Vrai échange SMTP (serveur local, authentification)');
  {
    const recus = [];
    const smtp = new SMTPServer({
      authOptional: false,
      allowInsecureAuth: true,
      disabledCommands: ['STARTTLS'],
      onAuth(auth, session, cb) {
        if (auth.username === 'utilisateur' && auth.password === 'secret') return cb(null, { user: 1 });
        return cb(new Error('Identifiants refusés'));
      },
      onData(stream, session, cb) {
        let data = '';
        stream.on('data', (c) => { data += c; });
        stream.on('end', () => { recus.push({ data, to: session.envelope.rcptTo.map((x) => x.address) }); cb(); });
      },
    });
    await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
    const port = smtp.server.address().port;

    Object.assign(process.env, {
      SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false',
      SMTP_USER: 'utilisateur', SMTP_PASS: 'secret', ADMIN_EMAIL: 'patron@heritage.test', MAIL_FROM: 'Heritage <commandes@heritage.test>',
    });
    const s = await demarrer(appIsolee(creerOrders(db, creerMailer())));
    const r = await post(s.url, valide());
    assert.strictEqual(r.json.notifie, true);
    assert.strictEqual(recus.length, 1);
    assert.deepStrictEqual(recus[0].to, ['patron@heritage.test']);
    assert.ok(recus[0].data.includes(r.json.reference));
    ok('Nodemailer envoie bien au serveur SMTP avec authentification, au bon destinataire');
    await s.close();

    process.env.SMTP_PASS = 'mauvais';
    const s2 = await demarrer(appIsolee(creerOrders(db, creerMailer())));
    const log = console.error; console.error = () => {};
    const r2 = await post(s2.url, valide());
    console.error = log;
    assert.strictEqual(r2.status, 201); assert.strictEqual(r2.json.notifie, false);
    ok('mauvais mot de passe SMTP : commande gardée, notifie=false');
    await s2.close();
    await new Promise((res) => smtp.close(res));
    ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'ADMIN_EMAIL', 'MAIL_FROM'].forEach((k) => delete process.env[k]);
  }

  console.log(`\nTests commandes OK (${nb} vérifications)`);
}

main().catch((e) => { console.error('\nECHEC :', e.message); console.error(e.stack.split('\n').slice(1, 4).join('\n')); process.exit(1); });
