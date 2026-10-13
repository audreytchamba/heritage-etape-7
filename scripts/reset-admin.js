// Mot de passe admin oublie : genere un nouveau mot de passe temporaire (affiche une seule fois),
// le fera changer a la prochaine connexion et ferme toutes les sessions ouvertes.
// Usage : npm run admin:reset   (a lancer sur le serveur, ce qui prouve que vous y avez acces)
const db = require('../src/db');
const { creerAuth } = require('../src/admin/auth');

const r = creerAuth(db).reinitialiserMotDePasse();
console.log('\n=== Administration : mot de passe reinitialise ===');
console.log(`Identifiant  : ${r.identifiant}`);
console.log(`Mot de passe : ${r.motDePasse}`);
console.log('Temporaire : il sera a changer a la prochaine connexion. Il ne sera plus affiche.\n');
process.exit(0);
