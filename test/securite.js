// Etape 7 : tentatives d'attaque contre le site public (fichiers internes, traversee de chemin, en-tetes, erreurs).
const assert = require('assert');
const http = require('http');
process.env.DB_FILE = ':memory:';
process.env.BCRYPT_COST = '4';
const app = require('../src/server');

// Requete brute : fetch() corrige les chemins ("/../"), ici on envoie exactement ce qu'un attaquant enverrait
const brut = (port, chemin, options = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: 'localhost', port, path: chemin, method: options.method || 'GET', headers: options.headers || {} }, (res) => {
    let corps = ''; res.on('data', (c) => { corps += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corps }));
  });
  r.on('error', reject);
  if (options.corps) r.write(options.corps);
  r.end();
});

let n = 0;
const ok = (msg) => { n += 1; console.log(`  ok  ${msg}`); };

const server = app.listen(0, async () => {
  try {
    const { port } = server.address();
    console.log('Fichiers internes et traversee de chemin');
    const interdits = ['/.env', '/.env.example', '/../.env', '/..%2f.env', '/%2e%2e/.env', '/src/server.js', '/src/admin/auth.js',
      '/db/heritage.db', '/package.json', '/ROADMAP.md', '/test/admin.js', '/node_modules/express/package.json', '/outbox/', '/.git/config',
      '/uploads/../.env', '/uploads/%2e%2e/package.json', '/uploads/..%2fpackage.json', '/admin/../src/config.js', '/admin/%2e%2e/%2e%2e/package.json', '/%00', '/uploads/%00.png'];
    for (const c of interdits) {
      const r = await brut(port, c);
      assert.ok(r.status === 404 || r.status === 400 || r.status === 403, `${c} -> ${r.status}`);
      assert.ok(!/express|"name"|PASSWORD|SMTP_|sqlite|require\(/i.test(r.corps), `${c} laisse voir du contenu`);
    }
    ok(`${interdits.length} chemins interdits (.env, code, base, ../, %2e%2e, octet nul) : jamais de contenu`);

    console.log('En-tetes du site public');
    for (const c of ['/', '/menu.html', '/commande.html', '/api/menu', '/api/config', '/css/style.css']) {
      const h = (await brut(port, c)).headers;
      assert.ok(/default-src 'self'/.test(h['content-security-policy'] || ''), `${c} : CSP absente`);
      assert.ok(!/unsafe-inline|unsafe-eval/.test(h['content-security-policy']), `${c} : CSP trop permissive`);
      assert.ok(/frame-ancestors 'none'/.test(h['content-security-policy']), `${c} : frame-ancestors`);
      assert.strictEqual(h['x-content-type-options'], 'nosniff');
      assert.strictEqual(h['x-frame-options'], 'DENY');
      assert.ok(h['referrer-policy'] && h['permissions-policy']);
      assert.ok(!h['x-powered-by']);
      assert.ok(!h['strict-transport-security'], 'HSTS ne doit etre envoye qu\'en production');
    }
    ok('CSP stricte (ni unsafe-inline ni unsafe-eval), anti-iframe, nosniff, referrer, permissions sur chaque reponse');

    console.log('Erreurs');
    const r404 = await brut(port, '/page-inconnue');
    assert.strictEqual(r404.status, 404);
    assert.ok(!/at |node_modules|\.js:\d/.test(r404.corps), 'trace technique');
    const mauvaisJson = await brut(port, '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, corps: '{"a":' });
    assert.ok(mauvaisJson.status === 400 && !/at |node_modules|SyntaxError/.test(mauvaisJson.corps), 'JSON invalide : ' + mauvaisJson.status);
    const mauvaisChemin = await brut(port, '/%E0%A4%A');
    assert.ok(mauvaisChemin.status === 400 || mauvaisChemin.status === 404, 'URL mal encodee : ' + mauvaisChemin.status);
    assert.ok(!/at |node_modules/.test(mauvaisChemin.corps), 'trace technique URL invalide');
    ok('404, JSON invalide et URL mal encodee : message simple, aucune trace ni chemin de fichier');

    console.log('Methodes et injections');
    const put = await brut(port, '/api/menu', { method: 'PUT', headers: { 'content-type': 'application/json' }, corps: '{}' });
    assert.ok(put.status === 404 || put.status === 405, 'PUT /api/menu : ' + put.status);
    const sql = await brut(port, '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, corps: JSON.stringify({ identifiant: "admin' OR '1'='1", motDePasse: "' OR '1'='1" }) });
    assert.strictEqual(sql.status, 401);
    const objet = await brut(port, '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, corps: JSON.stringify({ identifiant: { $ne: null }, motDePasse: ['x'] }) });
    assert.ok(objet.status === 400 || objet.status === 401, 'types inattendus : ' + objet.status);
    assert.ok(!/set-cookie/i.test(JSON.stringify(sql.headers)) && !/set-cookie/i.test(JSON.stringify(objet.headers)), 'cookie donne a tort');
    ok('injection SQL et objets JSON a la place du mot de passe : refuses, aucune session');

    console.log(`\nTests securite OK (${n} groupes de verifications)`);
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('ECHEC :', e.message);
    server.close();
    process.exit(1);
  }
});
