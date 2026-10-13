# ROADMAP — Site web Heritage (Bastos, Yaounde)

## Instructions pour Claude (a lire avant toute action)

Tu es le developpeur unique de ce projet. Tu travailles seul, de maniere autonome,
en suivant les etapes ci-dessous dans l'ordre. Tu ne demandes pas confirmation
avant chaque petite decision technique : tu avances, tu documentes tes choix dans
la section "Journal" en bas de ce fichier, et tu ne poses une question a Audrey
que si tu es bloque par une information qu'elle seule peut donner (exemple :
un vrai numero de telephone, une adresse email).

Regle n°1 : avant de commencer, lis entierement ce fichier, surtout la section
"Etat d'avancement" en bas, pour savoir exactement ou le projet en est.

Regle n°2 : des qu'une etape est terminee et testee, coche sa case ci-dessous
et ecris 3 a 5 lignes dans le Journal (ce qui a ete fait, les choix techniques,
ce qu'il reste a faire). C'est ce qui te permet, dans une future conversation,
de reprendre sans tout relire.

Regle n°3 : fais les choses toi-meme. N'ecris pas "voici le code, a toi de
l'integrer" : cree ou modifie directement les fichiers du projet. Lance les
commandes necessaires (npm install, tests, etc.) et corrige les erreurs sans
attendre qu'Audrey te les retranscrive, sauf si tu n'as pas la main sur le
terminal — dans ce cas donne la commande exacte a copier-coller.

Regle n°4 : a la fin de CHAQUE etape, meme si tu pourrais continuer, arrete-toi,
mets a jour ce fichier, et dis a Audrey en une phrase ce qui est fait et quelle
est la prochaine etape. Elle decide quand enchainer.
A chaque fin d'etape, envoie-lui aussi le projet zippe (heritage-etape-N.zip,
sans node_modules, sans fichiers .db ni .env) avec SendUserFile.

Regle n°5 (securite) : c'est le domaine d'Audrey, pas seulement le tien.
Applique les bonnes pratiques par defaut (requetes parametrees, mots de passe
haches avec bcrypt, validation des entrees, pas de secret en dur dans le code,
protection CSRF sur /admin). A l'etape Audit, explique-lui clairement CE QUE tu
as verifie et pourquoi, pour qu'elle puisse te challenger.

---

## Contexte du projet

Site vitrine + commande en ligne pour un restaurant fictif-portfolio nomme
Heritage, situe a Bastos, Yaounde, Cameroun. Cuisine locale (poulet/poisson
grille, ndole, taro) et occidentale (burgers, pizzas, tacos). Ambiance
conviviale, soiree karaoke le vendredi.

Objectif : projet de portfolio pour demarcher des clients freelance a Yaounde.
Le restaurant Heritage existe reellement mais n'a pas encore de site : ce
projet sert d'abord de demo a lui presenter, pas un site deja commande par lui.

Stack : Node.js + Express (backend), HTML/CSS/JS (frontend), SQLite (donnees),
Nodemailer (email). Pas de compte client. Mobile-first.

---

## Etat d'avancement

- [x] Etape 0 — Initialisation du projet (structure de dossiers, package.json,
      serveur Express minimal qui repond "OK", connexion SQLite, premieres
      tables : plats, categories)
- [x] Etape 1 — Page d'accueil (banniere, accroche "Cuisine locale et
      internationale au coeur de Bastos", points forts, infos pratiques,
      adresse/horaires/telephone/carte, footer Facebook/Instagram)
- [x] Etape 2 — Page Menu (plats par categories : Grillades, Plats locaux,
      Occidental, Boissons ; filtres par categorie ; tri par prix ; fiche
      plat avec photo/nom/description/prix/bouton "Ajouter au panier")
- [x] Etape 3 — Panier (icone fixe avec compteur, volet ou page panier,
      quantites modifiables, total automatique, bouton "Commander")
- [x] Etape 4 — Commande version A : formulaire (nom, telephone, date/heure
      souhaitees) qui genere un lien WhatsApp pre-rempli avec le recapitulatif
- [x] Etape 5 — Commande version B : meme formulaire, envoi automatique d'un
      email a l'administrateur via Nodemailer avec le detail de la commande
- [x] Etape 6 — Interface /admin : connexion securisee (bcrypt, session,
      CSRF, limitation des tentatives), liste des plats, ajout/modification/
      suppression, changement de prix, upload de photo, bouton
      "epuise/disponible", gestion des categories, utilisable sur telephone
- [x] Etape 7 — Audit de securite : relecture complete du code par Claude,
      rapport ecrit des points verifies et des risques residuels, pour
      qu'Audrey puisse tester elle-meme les points cles
- [ ] Etape 8 — Finitions : design responsive verifie sur mobile, README
      clair, captures d'ecran pour le portfolio Upwork, courte video de demo

---

## Journal (rempli par Claude au fur et a mesure)

### Etape 0 — termine le 2026-10-11
- Structure : /src (server.js, db.js), /public (vide, pour l'etape 1), /db
  (fichier heritage.db cree au demarrage, ignore par git), /test (smoke.js).
- Express + better-sqlite3 (synchrone, plus simple ici). Route GET /health
  repond "OK". Variables d'environnement : PORT, DB_FILE. Lancer : npm start.
- Tables : categories (id, name unique) et dishes (id, name, description,
  price en FCFA entier, category_id -> categories, photo_url, available 0/1).
  Choix : category_id (cle etrangere) plutot qu'un nom en texte, pour que la
  gestion des categories de l'etape 6 reste propre.
- 4 categories inserees au demarrage (Grillades, Plats locaux, Occidental,
  Boissons), de maniere idempotente. Aucun plat n'est encore insere.
- Test : npm test (smoke.js) verifie /health, les categories et les colonnes.
- Prochaine etape : Etape 1 (page d'accueil). Info a demander a Audrey a ce
  moment-la : vrai telephone, horaires, liens Facebook/Instagram (sinon
  valeurs fictives clairement marquees).

### Etape 1 — termine le 2026-10-11
- Fichiers : public/index.html, public/css/style.css, public/js/home.js.
  Sections : hero (accroche + statut ouvert/ferme + 2 boutons), points forts,
  bandeau karaoke du vendredi, "Nous trouver" (adresse, telephone, horaires,
  carte OpenStreetMap), footer Facebook/Instagram. Teste mobile (390px),
  1280px et 1920px : pas de scroll horizontal, contenu aligne, pas d'erreur JS.
- Design (skill frontend-design) : fond taro (violet-gris), vert ndole, orange
  braise, violet nuit pour le karaoke. Titres Bricolage Grotesque, texte
  Instrument Sans (Google Fonts). Barres de grill en bas du hero.
- Le statut "Ouvert maintenant / Ferme" est calcule en JS a partir du tableau
  des horaires (source unique : attributs data- du HTML), en heure de Yaounde.
- VALEURS FICTIVES a remplacer par les vraies : telephone (+237 600 000 000,
  dans index.html, lien tel:), horaires (tableau .horaires dans index.html),
  liens Facebook/Instagram (href="#" dans le footer), adresse exacte (rue) et
  position du marqueur de la carte (coordonnees approximatives de Bastos).
- Liens "Menu" pointent vers /menu.html (cree a l'etape 2, 404 d'ici la).
- Pour l'audit (etape 7) : la carte est une iframe externe (OpenStreetMap) et
  les polices viennent de Google Fonts ; prevoir une politique CSP adaptee.
- Prochaine etape : Etape 2 (page Menu : categories, filtres, tri par prix,
  fiches plats, plats de demonstration a inserer en base).

### Etape 2 — termine le 2026-10-11
- Base : 16 plats de demonstration (4 par categorie) inseres au demarrage
  seulement si la table dishes est vide (src/db.js). Prix en FCFA entiers.
  "Taro sauce jaune" est marque epuise pour montrer ce cas. A REMPLACER par
  les vrais plats/prix via /admin (etape 6). Photos : 4 illustrations SVG
  provisoires dans public/img/ (une par categorie), a remplacer par de vraies
  photos (upload en etape 6).
- API : GET /api/menu -> { categories, dishes } (src/server.js, requetes sans
  parametre utilisateur).
- Pages : public/menu.html, css/menu.css, js/menu.js. Filtres par categorie
  (boutons aria-pressed), tri par prix croissant/decroissant (client), barre
  de filtres collante. Sans tri : plats groupes par categorie. Plat epuise :
  photo grisee, etiquette "Epuise", pas de bouton. Erreur reseau : message +
  bouton "Reessayer". Tout texte venant de la base est insere avec
  textContent (pas d'innerHTML) pour eviter le XSS.
- Le bouton "Ajouter au panier" emet l'evenement DOM "panier:ajouter"
  (detail = le plat). Il n'a pas encore d'effet visible : c'est l'etape 3 qui
  ecoute cet evenement.
- Teste : npm test (menu.html, /api/menu, plat epuise), puis navigateur
  (filtres, tri, evenement, mobile 390px et 1280px, pas de scroll horizontal).
- Prochaine etape : Etape 3 (panier : icone fixe + compteur, volet panier,
  quantites, total, bouton Commander ; stockage dans localStorage).

### Etape 3 — termine le 2026-10-11
- Fichiers : public/js/panier.js et public/css/panier.css, charges sur
  index.html et menu.html. Icone fixe en bas a droite avec compteur ; volet
  lateral en <dialog> natif (Echap, clic sur le fond, focus piege, retour du
  focus). Lignes avec quantites +/- (1 a 20), "Retirer", total, "Vider le
  panier", bouton "Commander" (lien vers /commande.html, page creee a
  l'etape 4, 404 d'ici la). Annonce vocale (aria-live) a chaque ajout.
- Securite : localStorage ne contient que [{id, qty}] (cle heritage-panier).
  Noms et prix sont relus depuis /api/menu a chaque chargement, donc un prix
  falsifie dans le navigateur n'a aucun effet. Donnees stockees validees
  (entiers, qte bornee, doublons ecartes, JSON casse ignore). Plat inconnu ou
  epuise : retire du panier avec un message. Tout est insere via textContent.
  IMPORTANT pour les etapes 4/5 : le serveur doit recalculer le total a partir
  des id et quantites recus, jamais faire confiance au total du navigateur.
- API pour l'etape 4 : window.HeritagePanier.lignes() (id, qty, name, price),
  .total(), .vider(). Evenement d'entree : "panier:ajouter" (detail.id).
- Teste en navigateur (390px) : ajout, quantites, retrait, total, Echap,
  persistance au rechargement, localStorage falsifie, JSON casse, page
  d'accueil ; plus npm test. Pas d'erreur JS, pas de scroll horizontal.
- Prochaine etape : Etape 4 (page /commande.html : formulaire nom, telephone,
  date/heure souhaitees, recapitulatif du panier, lien WhatsApp pre-rempli).
  Info a demander a Audrey : le vrai numero WhatsApp du restaurant (sinon
  numero fictif marque comme tel).

### Etape 4 — termine le 2026-10-11
- Numero WhatsApp fourni par Audrey : +237 659855617. Il est dans
  src/config.js (variable d'environnement WHATSAPP_NUMBER pour le changer) et
  sert aussi de numero de telephone sur la page d'accueil (index.html, lien
  tel:). Les horaires sont aussi dans config.js : ils doivent rester
  identiques au tableau de index.html (deux endroits a tenir a jour).
- Fichiers : public/commande.html, css/commande.css, js/commande.js ; route
  GET /api/config (numero, fuseau, delai minimum 30 min, 30 jours max,
  horaires). Le bandeau .page-titre est passe dans style.css (partage).
- Page : recapitulatif du panier (relu depuis le serveur), formulaire nom /
  telephone / jour / heure. Validation : nom 2-80 caracteres avec lettres,
  caracteres de controle retires ; telephone camerounais (9 chiffres commencant
  par 6 ou 2, formats +237, 237, 00237, espaces et points acceptes) normalise
  en "+237 6 59 85 56 17" ; jour entre aujourd'hui et +30 jours ; heure dans
  les horaires du restaurant (service du vendredi jusqu'a 2h compris), au moins
  30 min apres maintenant, calcule en heure de Yaounde. Erreurs sous chaque
  champ + resume, focus sur le premier champ invalide.
- Envoi : ouvre https://wa.me/237659855617?text=... avec le recapitulatif
  (plats, quantites, total, nom, telephone, date et heure). Message encode avec
  encodeURIComponent : un nom malicieux ne peut pas ajouter de parametre. Le
  panier n'est PAS vide automatiquement (le client n'a peut-etre pas appuye
  sur Envoyer) : bouton "Commande envoyee : vider le panier et revenir au
  menu". L'icone flottante du panier est masquee sur cette page (le lien
  "Modifier mon panier" ouvre le meme volet).
- Limite assumee (version A) : tout se passe dans le navigateur, le serveur ne
  voit pas la commande ; le restaurant verifie lui-meme les prix. La version B
  (etape 5) recalculera tout cote serveur. Aussi : `.btn` herite maintenant de
  la police du site (les <button> utilisaient la police du navigateur).
- Teste en navigateur (390px et 1280px) : panier vide, champs vides, telephone
  invalide, jour passe/trop lointain, heure fermee, trop proche, samedi 1h
  (valide) et 3h (refuse), 5 formats de telephone, injection dans le nom,
  contenu exact du message, vidage du panier ; npm test.
- Prochaine etape : Etape 5 (meme formulaire, envoi automatique d'un email a
  l'administrateur via Nodemailer, avec enregistrement de la commande en base
  et recalcul du total cote serveur). Infos a demander a Audrey : l'adresse
  email de l'administrateur et un compte SMTP (sinon mode test avec Ethereal
  ou fichier local, sans secret dans le code : variables d'environnement).

### Etape 5 — termine le 2026-10-11
- Fichiers : src/validation.js (regles, faisant foi), src/mailer.js
  (Nodemailer), src/orders.js (POST /api/commandes + renvoi automatique),
  tables orders et order_items dans src/db.js, public/js/commande.js et
  commande.html/css mis a jour, .env.example, test/orders.js.
- Adresse de l'administrateur : NON FOURNIE. Aucune adresse inventee ni reprise
  du compte d'Audrey. Sans SMTP_HOST, on est en MODE TEST : les emails sont
  ecrits dans outbox/<reference>.eml (ignore par git). Pour envoyer pour de
  vrai : copier .env.example en .env, renseigner SMTP_* et ADMIN_EMAIL, lancer
  `node --env-file=.env src/server.js`. Aucun secret dans le code.
- Flux : le navigateur n'envoie que nom, telephone, jour, heure et [{id, qty}].
  Le serveur revalide tout, relit prix/noms/disponibilite en base, calcule le
  total, enregistre la commande (reference HER-XXXXXX), puis envoie l'email.
  Si l'email echoue, la commande reste enregistree, le client voit un message
  et un bouton WhatsApp de secours, et le serveur reessaie toutes les 2 minutes
  (5 essais max, sur 24 h). Le panier est vide seulement apres un envoi reussi.
- Interface : bouton principal "Envoyer ma commande" (email) + "Envoyer par
  WhatsApp a la place". ORDER_MODES=whatsapp (ou email) pour n'en garder qu'un.
  Ecran de confirmation avec la reference. Regle globale [hidden]{display:none}
  ajoutee (la classe .btn masquait l'attribut hidden : bug corrige).
- Securite (a challenger a l'etape 7) : requetes SQL parametrees ; corps JSON
  limite a 10 ko ; limite de 10 requetes / 10 min / IP (en memoire, par
  processus) ; champ piege anti-robot (fausse reussite, rien enregistre) ;
  noms nettoyes (caracteres de controle) donc pas d'injection d'en-tetes
  email ; sujet de l'email sans donnee client ; HTML de l'email echappe ;
  /api/config ne montre aucun reglage email. Pas de cookie ni de session, donc
  pas de CSRF sur cette route. Limites connues : derriere un proxy, regler
  `trust proxy` sinon toutes les requetes ont la meme IP ; pas de captcha ;
  un attaquant peut envoyer des commandes fausses (10 par IP et par 10 min) ;
  donnees personnelles (nom, telephone) gardees en base sans purge.
- Tests : `npm test` = smoke + 33 verifications serveur (total recalcule,
  validations, injection SQL/en-tetes/HTML, robot, JSON invalide, 413, limite
  429, email en echec puis renvoi, vrai serveur SMTP local avec mot de passe),
  puis navigateur : parcours complet, WhatsApp alternatif, double clic (1
  commande), erreurs serveur, reseau coupe, robot, SMTP en panne, mode
  WhatsApp seul, mobile et 1280 px.
- Prochaine etape : Etape 6 (/admin : connexion securisee bcrypt + session +
  CSRF + limitation des tentatives, CRUD plats/categories, prix, upload photo,
  epuise/disponible, utilisable sur telephone). A demander a Audrey : le mot de
  passe admin initial n'est pas a me donner : je genererai un mot de passe
  temporaire affiche une fois dans la console, a changer a la premiere
  connexion. Possible ajout utile : liste des commandes dans /admin.

### Etape 6 — termine le 2026-10-13
- Interface /admin (HTML/CSS/JS sans script ni style en ligne, compatible CSP) :
  connexion, plats (ajout, modification, prix, photo, disponible/epuise,
  suppression avec confirmation), categories, liste des commandes en lecture
  seule, changement de mot de passe. Pense pour le telephone (boutons 44-48 px).
- Securite : un seul compte, mot de passe bcrypt (cout 12) ; mot de passe
  temporaire de 16 caracteres affiche une fois en console et a changer des la
  premiere connexion (tout le reste est bloque jusque-la) ; cookie de session
  aleatoire 256 bits (HttpOnly, SameSite=Strict, Path=/admin), seul son SHA-256
  est en base ; jeton CSRF + controle Origin ; 5 echecs / 15 min / IP (50 au
  total) ; expiration 2 h d'inactivite / 12 h ; photos : type verifie sur le
  contenu (JPEG/PNG/WebP), nom aleatoire, 3 Mo max, redimensionnees et
  re-encodees par le navigateur (supprime les donnees GPS/EXIF).
- Note : une partie de l'etape 6 (routes, base, tests) existait deja dans le
  dossier avant ma reprise. Je l'ai conservee (elle avait des tests precis),
  j'ai ecrit le module auth.js qui manquait et toute l'interface, et supprime
  mes doublons. `npm run admin:reset` genere un nouveau mot de passe temporaire
  si Audrey l'oublie.
- Tests : `npm test` (49 verifications admin : acces sans connexion, CSRF,
  validations, photos piegees, en-tetes, expiration, limitation) + parcours
  navigateur reel a 390 px et 1280 px : mauvais mot de passe, changement force,
  ajout avec photo (visible sur l'API publique), prix invalide, dispo,
  categories (doublon refuse), suppression (photo effacee), reconnexion.
- A traiter a l'etape 7 : EXIF cote serveur (aujourd'hui seulement cote
  navigateur), compromis du blocage global (50 echecs bloquent aussi le vrai
  admin), `trust proxy`, CSP du site public, conservation des donnees clients.
- Prochaine etape : Etape 7 (audit de securite avec rapport ecrit).

### Etape 7 — termine le 2026-10-13
- Audit : relecture de tout le code, `npm audit` (0 vulnerabilite), attaques
  testees (SQL, objets JSON, `../`, `%2e%2e`, octet nul, fichiers internes,
  JSON invalide, URL mal encodee). Rapport complet dans `SECURITY.md` : points
  verifies avec la raison, corrections, risques restants R1 a R9, limites.
- Corrige : le site public n'avait aucun en-tete de securite -> CSP stricte
  (sans unsafe-inline), anti-iframe, nosniff, referrer, permissions, HSTS en
  production ; erreurs 404/500 sans trace technique. Nouveau `test/securite.js`
  (inclus dans `npm test`). Verifie dans le navigateur : aucune violation CSP.
- A faire au deploiement : NODE_ENV=production, TRUST_PROXY=1, HTTPS,
  politique de conservation des donnees clients (a decider avec le restaurant).
- Prochaine etape : Etape 8 (finitions : responsive, README, captures,
  courte video de demo).

<!-- Exemple de format a respecter :
### Etape 0 — termine le 2026-10-11
- Structure : /src, /public, /db. Express + better-sqlite3 choisis (plus
  simple que sqlite3 async pour ce projet).
- Tables creees : dishes (id, name, description, price, category, photo_url,
  available), categories (id, name).
- Prochaine etape : Etape 1 (page d'accueil).
→
