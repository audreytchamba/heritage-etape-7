# Rapport de sécurité — Heritage (étape 7)

Date : 2026-10-13. Méthode : relecture de tout le code (2 700 lignes), `npm audit`, tests d'attaque automatiques (`npm test`), parcours dans un vrai navigateur.
Ce document dit **ce qui a été vérifié, pourquoi, et ce qui reste risqué**, pour que tu puisses le contester.

## 1. Ce qui a été vérifié

| # | Risque | Ce que j'ai regardé | Résultat |
|---|--------|---------------------|----------|
| 1 | **Injection SQL** | Toutes les requêtes utilisent `?` (paramètres). Les 2 requêtes construites dynamiquement (`UPDATE dishes SET …`, `IN (…)`) n'assemblent que des noms de colonnes d'une liste blanche ou des `?`. Test : `admin' OR '1'='1` en identifiant. | Sûr |
| 2 | **XSS** (script injecté via un nom de plat, un nom de client…) | Aucun `innerHTML`/`eval`/`document.write` dans tout le code ; le texte est inséré avec `textContent`. Email de commande : HTML échappé. Les CSP interdisent de toute façon les scripts en ligne. | Sûr |
| 3 | **Mots de passe** | bcrypt coût 12, jamais en clair en base ni dans les réponses (testé : aucune réponse ne contient de hachage). Minimum 12 caractères, refus des mots de passe faciles. Mot de passe temporaire aléatoire (≈ 92 bits), à changer avant tout. | Sûr |
| 4 | **Sessions** | Cookie aléatoire 256 bits, `HttpOnly`, `SameSite=Strict`, limité à `/admin`, `Secure` en production. La base ne garde que son SHA-256 (une fuite de base ne donne aucune session). Expiration 2 h d'inactivité / 12 h. Fermées au changement de mot de passe. | Sûr |
| 5 | **CSRF** | Jeton propre à la session (en-tête `X-CSRF-Token`, comparaison à temps constant) + contrôle de l'en-tête `Origin` + `SameSite=Strict`. Testé : écriture sans jeton = 403. | Sûr |
| 6 | **Force brute** | 5 échecs / 15 min / IP, 50 au total. Comparaison bcrypt faite même si l'identifiant est faux (on ne peut pas deviner l'identifiant par le temps de réponse). | Sûr (voir risque R2) |
| 7 | **Envoi de fichiers** | Type vérifié sur les premiers octets du fichier (pas sur l'extension ni le type annoncé), uniquement JPEG/PNG/WebP (pas de SVG, qui peut contenir du code), 3 Mo max, nom aléatoire, dossier hors de `public/`, servi avec `nosniff` + `CSP default-src 'none'`. Suppression limitée aux noms de fichiers au format attendu. Testé : HTML déguisé en image, GIF, tronqué, `../`. | Sûr |
| 8 | **Accès aux fichiers internes** | 21 URL piégées testées (`/.env`, `/src/…`, `/db/heritage.db`, `/../.env`, `%2e%2e`, octet nul, `/uploads/../…`). Seul le dossier `public/` est servi. | Sûr |
| 9 | **Fuites d'information** | Pas de `X-Powered-By`. 404 / 500 / JSON invalide / URL mal encodée : message simple, jamais de trace ni de chemin de fichier. `/api/config` ne montre aucun réglage email ni admin. | Corrigé (voir §2) |
| 10 | **Injection d'en-têtes email** | Noms nettoyés (retours à la ligne retirés), sujet sans donnée client. | Sûr |
| 11 | **Triche sur les prix** | Le total est recalculé côté serveur à partir des prix en base ; le prix envoyé par le navigateur est ignoré. | Sûr |
| 12 | **Spam de commandes** | 10 commandes / 10 min / IP, champ piège anti-robot, corps limité à 10 ko. | Atténué (R3) |
| 13 | **Dépendances** | `npm audit` : 0 vulnérabilité connue. | Sûr |
| 14 | **Secrets** | Aucun secret dans le code ; réglages via `.env` (ignoré par git, absent du zip). Mot de passe admin affiché une seule fois. | Sûr |

## 2. Corrigé pendant l'audit

- **Le site public n'avait aucun en-tête de sécurité** (seul `/admin` en avait). Ajout sur toutes les réponses : CSP stricte sans `unsafe-inline` ni `unsafe-eval` (seuls Google Fonts et la carte OpenStreetMap sont autorisés), interdiction d'être affiché dans une iframe d'un autre site, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, et HSTS en production. Vérifié dans le navigateur : aucune violation, les pages et la commande fonctionnent.
- **Pages d'erreur** : une erreur inattendue pouvait afficher la page d'erreur par défaut d'Express (avec trace technique en développement). Remplacée par un message simple.
- Nouveau test `test/securite.js` pour que ces protections ne disparaissent pas par accident.

## 3. Risques restants (à connaître)

- **R1 – Photos : métadonnées (GPS/EXIF).** Le serveur ne ré-encode pas les images ; c'est le navigateur de l'admin qui les redimensionne et les ré-encode (ce qui supprime l'EXIF). Quelqu'un qui enverrait un fichier directement par l'API (il faut être connecté) pourrait en laisser. Risque faible : seul l'admin envoie des photos.
- **R2 – Blocage global des connexions.** Au-delà de 50 échecs en 15 min venant de partout, plus personne ne peut se connecter, vous compris, pendant 15 min. C'est un choix : on préfère bloquer un attaquant distribué que laisser deviner le mot de passe. Un attaquant motivé peut donc gêner l'accès à l'admin (pas le site public). Solution si besoin : `npm run admin:reset` ne contourne pas ce délai, mais le redémarrage du serveur le remet à zéro.
- **R3 – Fausses commandes.** Pas de captcha. Un robot patient (10 par adresse IP et par 10 min) peut remplir la boîte mail. Le champ piège arrête les robots simples. Si cela arrive : ajouter un captcha (Cloudflare Turnstile) ou activer la confirmation par WhatsApp uniquement (`ORDER_MODES=whatsapp`).
- **R4 – Limites en mémoire.** Les compteurs de tentatives sont perdus au redémarrage et ne sont pas partagés si plusieurs copies du serveur tournent. Suffisant pour un seul serveur.
- **R5 – Derrière un proxy/hébergeur.** Il faut définir `TRUST_PROXY=1` (nombre de proxys) et `NODE_ENV=production`, sinon toutes les requêtes semblent venir de la même adresse (limitation inutile ou trop sévère) et la CSP/HSTS ne sont pas complets. À faire au déploiement. Le site doit être servi en HTTPS (sinon le cookie « Secure » ne sera pas accepté).
- **R6 – Données personnelles.** Nom, téléphone et contenu des commandes restent en base sans durée limite. À décider avec le restaurant (purge après N mois) avant une vraie mise en ligne. La base n'est pas chiffrée : protéger l'accès au serveur et faire des sauvegardes.
- **R7 – Compte unique, pas de double authentification.** Un seul mot de passe protège l'admin. Il est solide s'il est choisi correctement (12 caractères minimum), mais s'il est volé il n'y a pas de seconde barrière.
- **R8 – Pas de journal d'audit** des actions admin (qui a modifié quoi). Seuls les échecs de connexion sont journalisés (adresse IP uniquement).
- **R9 – Polices et carte externes.** Google Fonts et OpenStreetMap reçoivent l'adresse IP des visiteurs. Acceptable pour un site vitrine ; à mentionner dans une politique de confidentialité pour un vrai restaurant.

## 4. Ce que je n'ai pas pu vérifier

- Le comportement derrière un vrai hébergeur HTTPS (je n'ai testé qu'en local).
- L'envoi d'email avec de vrais identifiants SMTP (testé avec un serveur SMTP local simulé).
- Un test d'intrusion par un tiers : cet audit est une relecture et des tests automatisés, pas une certification.
