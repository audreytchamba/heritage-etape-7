const assert = require('assert');
process.env.DB_FILE = ':memory:';
const app = require('../src/server');
const db = require('../src/db');

const server = app.listen(0, async () => {
  try {
    const { port } = server.address();
    const res = await fetch(`http://localhost:${port}/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), 'OK');

    const cats = db.prepare('SELECT name FROM categories ORDER BY id').all().map((c) => c.name);
    assert.deepStrictEqual(cats, ['Grillades', 'Plats locaux', 'Occidental', 'Boissons']);

    const cols = db.prepare('PRAGMA table_info(dishes)').all().map((c) => c.name);
    ['id', 'name', 'description', 'price', 'category_id', 'photo_url', 'available'].forEach((c) =>
      assert.ok(cols.includes(c), `colonne manquante: ${c}`)
    );
    const home = await fetch(`http://localhost:${port}/`);
    assert.strictEqual(home.status, 200);
    const html = await home.text();
    assert.ok(html.includes('Cuisine locale et internationale au cœur de Bastos'), 'accroche absente');
    assert.ok(html.includes('id="infos"'), 'section infos absente');
    assert.ok(html.includes('/js/panier.js'), 'panier absent de l\'accueil');
    for (const f of ['/css/style.css', '/js/home.js', '/js/panier.js', '/css/panier.css']) {
      const r = await fetch(`http://localhost:${port}${f}`);
      assert.strictEqual(r.status, 200, `${f} introuvable`);
    }
    const menuPage = await fetch(`http://localhost:${port}/menu.html`);
    assert.strictEqual(menuPage.status, 200);
    assert.ok((await menuPage.text()).includes('/js/panier.js'), 'panier absent de la page menu');

    const api = await (await fetch(`http://localhost:${port}/api/menu`)).json();
    assert.strictEqual(api.categories.length, 4);
    assert.ok(api.dishes.length >= 12, 'plats de demo absents');
    api.dishes.forEach((d) => {
      assert.ok(Number.isInteger(d.price) && d.price >= 0, `prix invalide: ${d.name}`);
      assert.strictEqual(typeof d.available, 'boolean');
      assert.ok(api.categories.some((c) => c.id === d.categoryId), `categorie inconnue: ${d.name}`);
    });
    assert.ok(api.dishes.some((d) => !d.available), 'aucun plat epuise pour la demo');

    const cfg = await (await fetch(`http://localhost:${port}/api/config`)).json();
    assert.match(cfg.whatsapp, /^\d{10,15}$/, 'numero WhatsApp invalide');
    assert.strictEqual(Object.keys(cfg.horaires).length, 7);
    const cmd = await fetch(`http://localhost:${port}/commande.html`);
    assert.strictEqual(cmd.status, 200);
    for (const f of ['/js/commande.js', '/css/commande.css']) {
      assert.strictEqual((await fetch(`http://localhost:${port}${f}`)).status, 200, `${f} introuvable`);
    }

    console.log('Smoke test OK');
  } catch (e) {
    console.error('Smoke test ECHEC:', e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
