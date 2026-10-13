// Tests de l'interface d'administration (étape 6). Lancer : node test/admin.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');

process.env.DB_FILE = ':memory:';
process.env.BCRYPT_COST = '4';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'heritage-uploads-'));
process.env.OUTBOX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'heritage-outbox-'));
process.env.ORDER_RATE_MAX = '1000';
delete process.env.SMTP_HOST;
delete process.env.ADMIN_INITIAL_PASSWORD;

const db = require('../src/db');
const config = require('../src/config');
const { creerAdmin } = require('../src/admin/routes');
const { creerAuth } = require('../src/admin/auth');
const app = require('../src/server');

let nb = 0;
const ok = (nom) => { nb += 1; console.log(`  ok  ${nom}`); };
const TOUT = []; // tout ce que le serveur a répondu : on y cherche des fuites de secrets

const MDP_TEMP = 'Temporaire-2026-xyz';
const MDP_NEUF = 'Nouveau-mot-de-passe-2026';

function demarrer(a) {
  return new Promise((resolve) => {
    const s = a.listen(0, () => resolve({ url: `http://localhost:${s.address().port}`, close: () => new Promise((r) => s.close(r)) }));
  });
}

class Client {
  constructor(url) { this.url = url; this.cookie = null; this.csrf = null; this.setCookie = []; }
  async req(methode, chemin, { json, raw, type, headers = {}, csrf = true, cookie = true } = {}) {
    const h = { ...headers };
    if (cookie && this.cookie) h.cookie = this.cookie;
    if (csrf && this.csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = this.csrf;
    let body;
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (raw !== undefined) { h['content-type'] = type; body = raw; }
    const r = await fetch(`${this.url}${chemin}`, { method: methode, headers: h, body });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) {
      this.setCookie = sc;
      const nom = sc[0].split(';')[0];
      this.cookie = nom.endsWith('=') ? null : nom; // un cookie vidé = déconnexion
    }
    const texte = await r.text();
    TOUT.push(texte);
    let corps = null;
    try { corps = JSON.parse(texte); } catch (e) { /* pas du JSON */ }
    return { status: r.status, corps, texte, entetes: r.headers };
  }
  async connecter(mdp) {
    const r = await this.req('POST', '/admin/api/login', { json: { identifiant: 'admin', motDePasse: mdp }, csrf: false });
    if (r.corps && r.corps.csrf) this.csrf = r.corps.csrf;
    return r;
  }
}

// Images minimales dont seuls les premiers octets comptent
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2), Buffer.from([0xff, 0xd9])]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(40));
const fichiers = () => fs.readdirSync(process.env.UPLOAD_DIR);

function definirMotDePasse(mdp, doitChanger) {
  db.prepare('UPDATE admin SET password_hash = ?, must_change = ?').run(bcrypt.hashSync(mdp, 4), doitChanger ? 1 : 0);
  db.prepare('DELETE FROM sessions').run();
}

async function main() {
  const serveur = await demarrer(app);
  const U = serveur.url;
  const anonyme = new Client(U);

  console.log('Sans connexion');
  {
    for (const [m, c] of [['GET', '/admin/api/plats'], ['GET', '/admin/api/commandes'], ['POST', '/admin/api/plats'], ['PUT', '/admin/api/plats/1'], ['DELETE', '/admin/api/plats/1'], ['GET', '/admin/api/categories']]) {
      const r = await anonyme.req(m, c, m === 'GET' ? {} : { json: {} });
      assert.ok(r.status === 401 || r.status === 404, `${m} ${c} => ${r.status}`);
      if (c !== '/admin/api/categories') assert.strictEqual(r.status, 401, `${m} ${c} devrait exiger une connexion`);
    }
    ok('plats, commandes : 401 sans session');
    const s = await anonyme.req('GET', '/admin/api/session');
    assert.deepStrictEqual(s.corps, { connecte: false });
    ok('/session sans cookie : { connecte: false }, aucun jeton');
    const faux = new Client(U); faux.cookie = 'heritage_admin=n-importe-quoi';
    assert.strictEqual((await faux.req('GET', '/admin/api/plats')).status, 401);
    ok('cookie inventé refusé');
  }

  console.log('Connexion');
  {
    definirMotDePasse(MDP_TEMP, true);
    const c = new Client(U);
    const mauvaisMdp = await c.connecter('pas-le-bon-mot-de-passe');
    const c2 = new Client(U);
    const mauvaisId = await c2.req('POST', '/admin/api/login', { json: { identifiant: 'root', motDePasse: MDP_TEMP }, csrf: false });
    assert.strictEqual(mauvaisMdp.status, 401);
    assert.strictEqual(mauvaisId.status, 401);
    assert.deepStrictEqual(mauvaisMdp.corps, mauvaisId.corps);
    ok('mauvais mot de passe et mauvais identifiant : même réponse (pas d’énumération)');

    assert.strictEqual((await c.req('POST', '/admin/api/login', { json: { identifiant: 'admin' }, csrf: false })).status, 400);
    assert.strictEqual((await c.req('POST', '/admin/api/login', { json: { identifiant: { $ne: 1 }, motDePasse: { $ne: 1 } }, csrf: false })).status, 400);
    assert.strictEqual((await c.req('POST', '/admin/api/login', { json: { identifiant: 'admin', motDePasse: 'x'.repeat(500) }, csrf: false })).status, 400);
    ok('champs manquants, objets (injection NoSQL), mot de passe géant : 400');

    const evil = await c.req('POST', '/admin/api/login', { json: { identifiant: 'admin', motDePasse: MDP_TEMP }, headers: { origin: 'https://evil.example' }, csrf: false });
    assert.strictEqual(evil.status, 403);
    ok('connexion depuis un autre site (Origin) : 403');

    const bon = await c.connecter(MDP_TEMP);
    assert.strictEqual(bon.status, 200);
    assert.strictEqual(bon.corps.doitChangerMotDePasse, true);
    const flags = c.setCookie[0];
    assert.ok(/HttpOnly/i.test(flags) && /SameSite=Strict/i.test(flags) && /Path=\/admin/i.test(flags), flags);
    assert.ok(!/Secure/i.test(flags), 'pas de Secure en http local');
    assert.ok(!flags.includes(MDP_TEMP));
    ok('cookie : HttpOnly, SameSite=Strict, Path=/admin');

    const tok = c.cookie.split('=')[1];
    const ligne = db.prepare('SELECT id_hash FROM sessions').get();
    assert.strictEqual(ligne.id_hash.length, 64);
    assert.notStrictEqual(ligne.id_hash, tok);
    ok('la base ne garde que le SHA-256 du cookie');

    // fixation de session : se reconnecter avec un cookie existant invalide l'ancien
    const ancien = c.cookie;
    await c.connecter(MDP_TEMP);
    const vieux = new Client(U); vieux.cookie = ancien;
    assert.strictEqual((await vieux.req('GET', '/admin/api/session')).corps.connecte, false);
    ok('chaque connexion crée une nouvelle session (pas de fixation)');
  }

  console.log('Mot de passe temporaire à changer');
  {
    const a = new Client(U); await a.connecter(MDP_TEMP);
    const autre = new Client(U); await autre.connecter(MDP_TEMP);

    const bloque = await a.req('GET', '/admin/api/plats');
    assert.strictEqual(bloque.status, 403);
    assert.strictEqual(bloque.corps.code, 'changer_mot_de_passe');
    assert.strictEqual((await a.req('POST', '/admin/api/plats', { json: { name: 'x', price: 1, categoryId: 1 } })).status, 403);
    ok('tant que le mot de passe est temporaire, plats et écritures sont bloqués');

    assert.strictEqual((await a.req('POST', '/admin/api/mot-de-passe', { json: { actuel: MDP_TEMP, nouveau: MDP_NEUF }, csrf: false })).status, 403);
    ok('changement de mot de passe sans jeton CSRF : 403');

    const faux = await a.req('POST', '/admin/api/mot-de-passe', { json: { actuel: 'mauvais', nouveau: MDP_NEUF } });
    assert.ok(faux.status === 400 && faux.corps.erreurs.actuel);
    for (const [mdp, motif] of [['court', 'trop court'], ['aaaaaaaaaaaaaaaa', 'répétitif'], ['xx-admin-xx-1234', 'contient l’identifiant'], [MDP_TEMP, 'identique à l’actuel'], ['é'.repeat(40), 'plus de 72 octets']]) {
      const r = await a.req('POST', '/admin/api/mot-de-passe', { json: { actuel: MDP_TEMP, nouveau: mdp } });
      assert.ok(r.status === 400 && r.corps.erreurs.nouveau, `devrait refuser : ${motif}`);
    }
    ok('mauvais mot de passe actuel et 5 mots de passe faibles refusés');

    const change = await a.req('POST', '/admin/api/mot-de-passe', { json: { actuel: MDP_TEMP, nouveau: MDP_NEUF } });
    assert.strictEqual(change.status, 200);
    assert.strictEqual((await a.req('GET', '/admin/api/plats')).status, 200);
    ok('nouveau mot de passe accepté, l’administration se débloque');

    assert.strictEqual((await autre.req('GET', '/admin/api/session')).corps.connecte, false);
    ok('les autres sessions sont fermées après le changement');

    const hash = db.prepare('SELECT password_hash FROM admin').get().password_hash;
    assert.ok(hash.startsWith('$2') && !hash.includes(MDP_NEUF));
    assert.strictEqual((await new Client(U).connecter(MDP_TEMP)).status, 401);
    assert.strictEqual((await new Client(U).connecter(MDP_NEUF)).status, 200);
    ok('mot de passe stocké en bcrypt ; l’ancien ne marche plus, le nouveau oui');
  }

  const admin = new Client(U);
  await admin.connecter(MDP_NEUF);

  console.log('Protection CSRF');
  {
    const corps = { name: 'Test CSRF', price: 1000, categoryId: 1 };
    assert.strictEqual((await admin.req('POST', '/admin/api/plats', { json: corps, csrf: false })).status, 403);
    assert.strictEqual((await admin.req('POST', '/admin/api/plats', { json: corps, headers: { 'x-csrf-token': 'faux' } })).status, 403);
    assert.strictEqual((await admin.req('POST', '/admin/api/plats', { json: corps, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.strictEqual((await admin.req('DELETE', '/admin/api/plats/1', { csrf: false })).status, 403);
    assert.strictEqual((await admin.req('PUT', '/admin/api/plats/1', { json: { price: 1 }, csrf: false })).status, 403);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM dishes WHERE name = ?').get('Test CSRF').n, 0);
    ok('création, modification, suppression : refusées sans jeton valide ou depuis un autre site');
    const sessionAutre = new Client(U); await sessionAutre.connecter(MDP_NEUF);
    assert.strictEqual((await admin.req('POST', '/admin/api/plats', { json: corps, headers: { 'x-csrf-token': sessionAutre.csrf } })).status, 403);
    ok('le jeton d’une autre session est refusé');
    await admin.req('POST', '/admin/api/logout');
    await admin.connecter(MDP_NEUF);
  }

  console.log('Plats');
  let platId;
  {
    const liste = await admin.req('GET', '/admin/api/plats');
    assert.strictEqual(liste.corps.plats.length, 16);
    assert.strictEqual(liste.corps.categories.length, 4);
    assert.strictEqual(liste.corps.categories[0].nbPlats, 4);
    ok('liste : 16 plats, 4 catégories avec leur nombre de plats');

    const cree = await admin.req('POST', '/admin/api/plats', { json: { name: '  Brochettes   de  poisson ', description: 'Au feu de bois', price: 4500, categoryId: 1, available: true } });
    assert.strictEqual(cree.status, 201);
    platId = cree.corps.id;
    assert.strictEqual(cree.corps.name, 'Brochettes de poisson');
    assert.strictEqual(cree.corps.photoUrl, null);
    ok('création (espaces normalisés)');

    const invalides = [
      [{ name: '', price: 1, categoryId: 1 }, 'name'], [{ name: 'x'.repeat(81), price: 1, categoryId: 1 }, 'name'],
      [{ name: 'A', price: -1, categoryId: 1 }, 'price'], [{ name: 'A', price: 1.5, categoryId: 1 }, 'price'],
      [{ name: 'A', price: '100', categoryId: 1 }, 'price'], [{ name: 'A', price: 1e9, categoryId: 1 }, 'price'],
      [{ name: 'A', price: 1, categoryId: 9999 }, 'categoryId'], [{ name: 'A', price: 1, categoryId: '1' }, 'categoryId'],
      [{ name: 'A', price: 1, categoryId: 1, available: 'oui' }, 'available'],
      [{ name: 'A', price: 1, categoryId: 1, description: 'x'.repeat(301) }, 'description'],
      [{ name: ['A'], price: 1, categoryId: 1 }, 'name'],
    ];
    for (const [corps, champ] of invalides) {
      const r = await admin.req('POST', '/admin/api/plats', { json: corps });
      assert.ok(r.status === 400 && r.corps.erreurs[champ], `devrait refuser (${champ}) : ${JSON.stringify(corps).slice(0, 60)}`);
    }
    assert.strictEqual((await admin.req('POST', '/admin/api/plats', { json: [1, 2] })).status, 400);
    ok(`${invalides.length + 1} entrées invalides refusées (nom, prix, catégorie, disponibilité, description)`);

    const sql = await admin.req('POST', '/admin/api/plats', { json: { name: "x'); DROP TABLE dishes;--", price: 100, categoryId: 1 } });
    const xss = await admin.req('POST', '/admin/api/plats', { json: { name: '<img src=x onerror=alert(1)>', price: 100, categoryId: 1 } });
    assert.strictEqual(sql.status, 201); assert.strictEqual(xss.status, 201);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM dishes').get().n > 16);
    assert.strictEqual(xss.corps.name, '<img src=x onerror=alert(1)>');
    ok('injection SQL : stockée telle quelle, table intacte ; HTML conservé en texte (l’interface l’affiche en texte brut)');
    await admin.req('DELETE', `/admin/api/plats/${sql.corps.id}`); await admin.req('DELETE', `/admin/api/plats/${xss.corps.id}`);

    const prix = await admin.req('PUT', `/admin/api/plats/${platId}`, { json: { price: 5000 } });
    assert.strictEqual(prix.corps.price, 5000); assert.strictEqual(prix.corps.name, 'Brochettes de poisson');
    ok('changement de prix seul : le reste ne bouge pas');

    const hack = await admin.req('PUT', `/admin/api/plats/${platId}`, { json: { price: 5000, photoUrl: '/uploads/../../package.json', id: 1, photo_url: 'x' } });
    assert.strictEqual(hack.status, 200); assert.strictEqual(hack.corps.photoUrl, null); assert.strictEqual(hack.corps.id, platId);
    ok('champs non autorisés (photoUrl, id) ignorés');

    assert.strictEqual((await admin.req('PUT', `/admin/api/plats/${platId}`, { json: {} })).status, 400);
    for (const id of ['9999', 'abc', '1;DROP', '-1', '1.5']) assert.strictEqual((await admin.req('PUT', `/admin/api/plats/${id}`, { json: { price: 1 } })).status, 404);
    ok('modification vide : 400 ; identifiants inconnus ou piégés : 404');

    await admin.req('PUT', `/admin/api/plats/${platId}`, { json: { available: false } });
    const menu = await (await fetch(`${U}/api/menu`)).json();
    assert.strictEqual(menu.dishes.find((d) => d.id === platId).available, false);
    await admin.req('PUT', `/admin/api/plats/${platId}`, { json: { available: true } });
    assert.strictEqual((await (await fetch(`${U}/api/menu`)).json()).dishes.find((d) => d.id === platId).available, true);
    ok('« épuisé / disponible » visible tout de suite sur le menu public');

    // une commande publique d'un plat épuisé est refusée
    await admin.req('PUT', `/admin/api/plats/${platId}`, { json: { available: false } });
    const dateOk = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 3); while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    const cmd = await fetch(`${U}/api/commandes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nom: 'Awa Ngono', tel: '659855617', date: dateOk, heure: '19:30', lignes: [{ id: platId, qty: 1 }] }) });
    assert.strictEqual(cmd.status, 400);
    await admin.req('PUT', `/admin/api/plats/${platId}`, { json: { available: true } });
    ok('un plat passé en « épuisé » ne peut plus être commandé');

    const cmdOk = await fetch(`${U}/api/commandes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nom: 'Awa Ngono', tel: '659855617', date: dateOk, heure: '19:30', lignes: [{ id: platId, qty: 2 }] }) });
    assert.strictEqual(cmdOk.status, 201);
    const prixAncien = (await cmdOk.json()).total;
    assert.strictEqual(prixAncien, 10000);
    await admin.req('PUT', `/admin/api/plats/${platId}`, { json: { price: 6000 } });
    const cmds = await admin.req('GET', '/admin/api/commandes');
    const derniere = cmds.corps.commandes[0];
    assert.strictEqual(derniere.total, 10000);
    assert.strictEqual(derniere.lignes[0].prixUnitaire, 5000);
    assert.strictEqual(typeof derniere.emailEnvoye, 'boolean');
    assert.strictEqual(derniere.nom, 'Awa Ngono');
    ok('liste des commandes ; une commande garde le prix d’origine même si le prix change ensuite');
    await admin.req('PUT', `/admin/api/plats/${platId}`, { json: { price: 5000 } });
  }

  console.log('Catégories');
  {
    const cree = await admin.req('POST', '/admin/api/categories', { json: { name: '  Desserts ' } });
    assert.strictEqual(cree.status, 201); assert.strictEqual(cree.corps.name, 'Desserts');
    const id = cree.corps.id;
    assert.strictEqual((await admin.req('POST', '/admin/api/categories', { json: { name: 'desserts' } })).status, 409);
    assert.strictEqual((await admin.req('POST', '/admin/api/categories', { json: { name: ' ' } })).status, 400);
    assert.strictEqual((await admin.req('POST', '/admin/api/categories', { json: { name: 'x'.repeat(41) } })).status, 400);
    assert.strictEqual((await admin.req('POST', '/admin/api/categories', { json: { name: ['a'] } })).status, 400);
    ok('création ; doublon (sans tenir compte des majuscules), vide, trop long, mauvais type refusés');

    const ren = await admin.req('PUT', `/admin/api/categories/${id}`, { json: { name: 'Douceurs' } });
    assert.strictEqual(ren.corps.name, 'Douceurs');
    assert.strictEqual((await admin.req('PUT', `/admin/api/categories/${id}`, { json: { name: 'Grillades' } })).status, 409);
    ok('renommage ; nom déjà pris : 409');

    const p = await admin.req('POST', '/admin/api/plats', { json: { name: 'Gâteau', price: 1500, categoryId: id } });
    const refus = await admin.req('DELETE', `/admin/api/categories/${id}`);
    assert.strictEqual(refus.status, 409); assert.ok(/1 plat/.test(refus.corps.erreur));
    await admin.req('DELETE', `/admin/api/plats/${p.corps.id}`);
    assert.strictEqual((await admin.req('DELETE', `/admin/api/categories/${id}`)).status, 200);
    assert.strictEqual((await admin.req('DELETE', `/admin/api/categories/${id}`)).status, 404);
    ok('suppression refusée tant qu’elle contient des plats, puis acceptée une fois vide');
  }

  console.log('Photos');
  {
    const avantFichiers = fichiers().length;
    const envoi = (octets, type, c = admin, id = platId) => c.req('PUT', `/admin/api/plats/${id}/photo`, { raw: octets, type });

    const png = await envoi(PNG, 'image/png');
    assert.strictEqual(png.status, 200);
    assert.match(png.corps.photoUrl, /^\/uploads\/[a-f0-9]{32}\.png$/);
    const nomPng = path.basename(png.corps.photoUrl);
    assert.ok(fichiers().includes(nomPng));
    const servi = await fetch(`${U}${png.corps.photoUrl}`);
    assert.strictEqual(servi.status, 200);
    assert.strictEqual(servi.headers.get('content-type'), 'image/png');
    assert.strictEqual(servi.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(servi.headers.get('content-security-policy'), "default-src 'none'");
    ok('envoi PNG : fichier à nom aléatoire, servi avec le bon type et nosniff');

    const jpg = await envoi(JPG, 'image/jpeg');
    assert.strictEqual(jpg.status, 200);
    assert.ok(!fichiers().includes(nomPng), 'l’ancienne photo doit être supprimée');
    assert.strictEqual(fichiers().length, avantFichiers + 1);
    ok('remplacement : l’ancienne photo est supprimée du disque');

    assert.strictEqual((await envoi(HTML, 'image/jpeg')).status, 415);
    assert.strictEqual((await envoi(HTML, 'image/png')).status, 415);
    assert.strictEqual((await envoi(PNG, 'image/jpeg')).status, 415);
    assert.strictEqual((await envoi(Buffer.from('GIF89a' + 'x'.repeat(40)), 'image/png')).status, 415);
    assert.strictEqual((await envoi(PNG, 'text/plain')).status, 415);
    assert.strictEqual((await envoi(PNG.subarray(0, 5), 'image/png')).status, 415);
    assert.strictEqual(fichiers().length, avantFichiers + 1);
    ok('HTML déguisé en image, type annoncé différent du contenu, GIF, texte, fichier tronqué : 415, rien écrit');

    const gros = await envoi(Buffer.concat([PNG, Buffer.alloc(config.admin.photoMaxOctets + 10, 3)]), 'image/png');
    assert.strictEqual(gros.status, 413);
    ok('image de plus de 3 Mo : 413');

    assert.strictEqual((await envoi(PNG, 'image/png', new Client(U))).status, 401);
    assert.strictEqual((await admin.req('PUT', `/admin/api/plats/${platId}/photo`, { raw: PNG, type: 'image/png', csrf: false })).status, 403);
    assert.strictEqual((await envoi(PNG, 'image/png', admin, 9999)).status, 404);
    ok('envoi sans connexion : 401 ; sans jeton CSRF : 403 ; plat inconnu : 404');

    const sup = await admin.req('DELETE', `/admin/api/plats/${platId}/photo`);
    assert.strictEqual(sup.status, 200);
    assert.strictEqual(fichiers().length, avantFichiers);
    assert.strictEqual(db.prepare('SELECT photo_url FROM dishes WHERE id = ?').get(platId).photo_url, null);
    ok('suppression de la photo : fichier effacé, plat sans photo');

    await envoi(PNG, 'image/png');
    await admin.req('DELETE', `/admin/api/plats/${platId}`);
    assert.strictEqual(fichiers().length, avantFichiers);
    ok('suppression d’un plat : sa photo est effacée aussi');

    // une valeur piégée en base ne doit jamais permettre d'effacer un fichier hors du dossier des photos
    const piege = await admin.req('POST', '/admin/api/plats', { json: { name: 'Piège', price: 1, categoryId: 1 } });
    db.prepare('UPDATE dishes SET photo_url = ? WHERE id = ?').run('/uploads/../../package.json', piege.corps.id);
    await admin.req('DELETE', `/admin/api/plats/${piege.corps.id}`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'package.json')));
    ok('chemin piégé (../) : aucun fichier hors du dossier des photos n’est touché');

    // les illustrations provisoires du site ne sont jamais effacées
    const seed = db.prepare("SELECT id FROM dishes WHERE photo_url LIKE '/img/%' LIMIT 1").get();
    assert.ok(seed);
    ok('les illustrations provisoires (/img/…) ne sont pas dans le dossier des photos');
  }

  console.log('En-têtes de sécurité et fuites');
  {
    for (const chemin of ['/admin/', '/admin/api/session', '/admin/js/admin.js']) {
      const r = await fetch(`${U}${chemin}`);
      assert.ok(r.status === 200 || r.status === 404, `${chemin} => ${r.status}`);
      assert.match(r.headers.get('content-security-policy') || '', /default-src 'self'/, chemin);
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.strictEqual(r.headers.get('x-frame-options'), 'DENY');
      assert.strictEqual(r.headers.get('cache-control'), 'no-store');
      assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
      assert.strictEqual(r.headers.get('x-powered-by'), null);
    }
    ok('CSP, X-Frame-Options, no-store, nosniff, noindex sur /admin (pages et API) ; pas de X-Powered-By');

    const fuite = TOUT.join('\n');
    assert.ok(!/\$2[aby]\$/.test(fuite), 'un hachage bcrypt a fuité');
    assert.ok(!fuite.includes('password_hash') && !fuite.includes(MDP_NEUF) && !fuite.includes(MDP_TEMP));
    ok('aucune réponse ne contient de hachage ni de mot de passe');

    const cfg = JSON.stringify(await (await fetch(`${U}/api/config`)).json());
    assert.ok(!/admin|bcrypt|session/i.test(cfg));
    ok('/api/config ne dit rien de l’administration');
  }

  console.log('Déconnexion et expiration');
  {
    const c = new Client(U); await c.connecter(MDP_NEUF);
    const cookie = c.cookie;
    assert.strictEqual((await c.req('POST', '/admin/api/logout')).status, 200);
    const rejoue = new Client(U); rejoue.cookie = cookie;
    assert.strictEqual((await rejoue.req('GET', '/admin/api/plats')).status, 401);
    ok('après déconnexion, le cookie ne sert plus');

    const i = new Client(U); await i.connecter(MDP_NEUF);
    db.prepare('UPDATE sessions SET last_seen = ?').run(Date.now() - config.admin.inactiviteMs - 1000);
    assert.strictEqual((await i.req('GET', '/admin/api/plats')).status, 401);
    const l = new Client(U); await l.connecter(MDP_NEUF);
    db.prepare('UPDATE sessions SET created_at = ?').run(Date.now() - config.admin.dureeMaxMs - 1000);
    assert.strictEqual((await l.req('GET', '/admin/api/plats')).status, 401);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    ok('session expirée après 2 h d’inactivité ou 12 h au total, et supprimée de la base');
  }
  await serveur.close();

  console.log('Limitation des tentatives de connexion');
  {
    const a = express(); a.use(express.json({ limit: '10kb' })); a.use('/admin/api', creerAdmin(db).router);
    const s = await demarrer(a);
    const c = new Client(s.url);
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await c.connecter('mauvais-mot-de-passe')).status);
    assert.deepStrictEqual(codes, [401, 401, 401, 401, 401]);
    const bloque = await c.connecter(MDP_NEUF);
    assert.strictEqual(bloque.status, 429);
    assert.ok(Number(bloque.entetes.get('retry-after')) > 0);
    assert.strictEqual((await c.connecter('encore-faux')).status, 429);
    ok('5 échecs : la 6e tentative est bloquée (429 + Retry-After), même avec le bon mot de passe');
    await s.close();

    const a2 = express(); a2.use(express.json({ limit: '10kb' })); a2.use('/admin/api', creerAdmin(db).router);
    const s2 = await demarrer(a2);
    const c2 = new Client(s2.url);
    for (let i = 0; i < 4; i += 1) await c2.connecter('mauvais-mot-de-passe');
    assert.strictEqual((await c2.connecter(MDP_NEUF)).status, 200);
    for (let i = 0; i < 4; i += 1) await c2.connecter('mauvais-mot-de-passe');
    assert.strictEqual((await c2.connecter(MDP_NEUF)).status, 200);
    ok('une connexion réussie remet le compteur à zéro');
    await s2.close();

    const a3 = express(); a3.use(express.json({ limit: '10kb' })); a3.use('/admin/api', creerAdmin(db).router);
    const s3 = await demarrer(a3);
    const c3 = new Client(s3.url); await c3.connecter(MDP_NEUF);
    for (let i = 0; i < 5; i += 1) await c3.req('POST', '/admin/api/mot-de-passe', { json: { actuel: 'faux', nouveau: 'Un-autre-mot-de-passe-9' } });
    const r3 = await c3.req('POST', '/admin/api/mot-de-passe', { json: { actuel: MDP_NEUF, nouveau: 'Un-autre-mot-de-passe-9' } });
    assert.strictEqual(r3.status, 429);
    ok('essais répétés de « mot de passe actuel » : limités aussi');
    await s3.close();
  }

  console.log('Création du compte au premier démarrage');
  {
    const auth = creerAuth(db);
    db.prepare('DELETE FROM admin').run();
    const premier = auth.initialiserAdmin();
    assert.strictEqual(premier.identifiant, 'admin');
    assert.match(premier.motDePasse, /^[A-HJ-NP-Za-km-z2-9]{16}$/);
    assert.strictEqual(premier.doitChanger, true);
    const ligne = db.prepare('SELECT * FROM admin').get();
    assert.ok(ligne.password_hash.startsWith('$2') && !ligne.password_hash.includes(premier.motDePasse));
    assert.ok(bcrypt.compareSync(premier.motDePasse, ligne.password_hash));
    assert.strictEqual(ligne.must_change, 1);
    assert.strictEqual(auth.initialiserAdmin(), null);
    ok('mot de passe temporaire de 16 caractères, haché en base, à changer ; pas de second compte');

    db.prepare('DELETE FROM admin').run();
    process.env.ADMIN_INITIAL_PASSWORD = 'court';
    const faible = auth.initialiserAdmin();
    assert.ok(faible.doitChanger && faible.avertissement && faible.motDePasse !== 'court');
    db.prepare('DELETE FROM admin').run();
    process.env.ADMIN_INITIAL_PASSWORD = 'Mot-de-passe-choisi-2026';
    const choisi = auth.initialiserAdmin();
    assert.strictEqual(choisi.motDePasse, 'Mot-de-passe-choisi-2026');
    assert.strictEqual(choisi.doitChanger, false);
    delete process.env.ADMIN_INITIAL_PASSWORD;
    ok('ADMIN_INITIAL_PASSWORD : refusé s’il est faible, accepté sinon');
  }

  console.log(`\nTests administration OK (${nb} vérifications)`);
}

main().catch((e) => { console.error('\nECHEC :', e.message); console.error(e.stack.split('\n').slice(1, 5).join('\n')); process.exit(1); });
