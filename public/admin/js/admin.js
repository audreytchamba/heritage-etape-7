// Interface d'administration. Parle uniquement à /admin/api (même origine).
// Tout texte venant du serveur est inséré avec textContent : jamais de HTML construit à partir de données.
(function () {
  'use strict';

  var PLACEHOLDER = '/img/placeholder-plat.svg';
  var STATUTS = { nouvelle: 'Nouvelle', confirmee: 'Confirmée', terminee: 'Terminée', annulee: 'Annulée' };

  var etat = {
    csrf: null,
    doitChanger: false,
    plats: [],
    categories: [],
    commandes: [],
    filtre: '',
    onglet: 'plats',
    platEdite: null,   // plat en cours de modification (null = création)
    catEditee: null,
    photoBlob: null,   // nouvelle photo prête à être envoyée
    photoRetiree: false,
    aperçuUrl: null,
    occupe: false
  };

  var nf = new Intl.NumberFormat('fr-FR');
  function prix(n) { return nf.format(n).replace(/[  ]/g, ' ') + ' FCFA'; }
  function $(id) { return document.getElementById(id); }

  function el(tag, props, enfants) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else n.setAttribute(k, props[k]);
    });
    (enfants || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function vider(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  /* ---------- Messages ---------- */

  var minuteur = null;
  function toast(texte, erreur) {
    var t = $('toast');
    t.textContent = texte;
    t.className = 'toast visible' + (erreur ? ' erreur' : '');
    clearTimeout(minuteur);
    minuteur = setTimeout(function () { t.className = 'toast'; }, erreur ? 6000 : 3500);
  }

  function erreurChamp(id, message) {
    var p = $(id + '-erreur');
    var champ = $(id);
    if (!p) return;
    if (message) { p.textContent = message; p.hidden = false; if (champ) champ.setAttribute('aria-invalid', 'true'); }
    else { p.textContent = ''; p.hidden = true; if (champ) champ.removeAttribute('aria-invalid'); }
  }

  function alerte(id, message) {
    var a = $(id);
    if (message) { a.textContent = message; a.hidden = false; } else { a.textContent = ''; a.hidden = true; }
  }

  /* ---------- Appels au serveur ---------- */

  function api(methode, chemin, options) {
    options = options || {};
    var h = {};
    var corps;
    if (etat.csrf) h['X-CSRF-Token'] = etat.csrf;
    if (options.json !== undefined) { h['Content-Type'] = 'application/json'; corps = JSON.stringify(options.json); }
    if (options.blob) { h['Content-Type'] = options.blob.type; corps = options.blob; }

    return fetch('/admin/api' + chemin, { method: methode, headers: h, body: corps, credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (c) { return { status: r.status, corps: c || {} }; });
      }, function () {
        return { status: 0, corps: { erreur: 'Connexion impossible. Vérifiez votre réseau, puis réessayez.' } };
      })
      .then(function (rep) {
        if (rep.status === 401 && etat.csrf && chemin !== '/login') {
          montrerConnexion('Votre session a expiré. Reconnectez-vous.');
        } else if (rep.status === 403 && rep.corps.code === 'changer_mot_de_passe') {
          etat.doitChanger = true;
          montrerApp();
        }
        return rep;
      });
  }

  function messageErreur(rep, defaut) {
    return (rep.corps && rep.corps.erreur) || defaut || 'Une erreur est survenue. Réessayez.';
  }

  /* ---------- Vues ---------- */

  function montrerConnexion(message) {
    etat.csrf = null;
    etat.doitChanger = false;
    fermerDialogues();
    $('vue-app').hidden = true;
    $('vue-connexion').hidden = false;
    $('motdepasse').value = '';
    alerte('connexion-erreur', message || '');
    if (!message) $('identifiant').focus();
  }

  function montrerApp() {
    $('vue-connexion').hidden = true;
    $('vue-app').hidden = false;
    $('bandeau-mdp').hidden = !etat.doitChanger;
    Array.prototype.forEach.call(document.querySelectorAll('.onglet'), function (b) {
      b.disabled = etat.doitChanger && b.getAttribute('data-onglet') !== 'compte';
    });
    afficherOnglet(etat.doitChanger ? 'compte' : etat.onglet);
  }

  function afficherOnglet(nom) {
    etat.onglet = nom;
    ['plats', 'categories', 'commandes', 'compte'].forEach(function (n) {
      $('panneau-' + n).hidden = n !== nom;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.onglet'), function (b) {
      if (b.getAttribute('data-onglet') === nom) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    if (nom === 'plats' || nom === 'categories') chargerPlats();
    if (nom === 'commandes') chargerCommandes();
  }

  function fermerDialogues() {
    ['dlg-plat', 'dlg-cat', 'dlg-confirm'].forEach(function (id) { var d = $(id); if (d.open) d.close(); });
  }

  /* ---------- Plats ---------- */

  function nomCategorie(id) {
    var c = etat.categories.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : '';
  }

  function chargerPlats() {
    return api('GET', '/plats').then(function (rep) {
      if (rep.status !== 200) { $('plats-etat').textContent = messageErreur(rep, 'Impossible de charger les plats.'); return; }
      etat.plats = rep.corps.plats;
      etat.categories = rep.corps.categories;
      rendreFiltre();
      rendrePlats();
      rendreCategories();
    });
  }

  function rendreFiltre() {
    var s = $('filtre-categorie');
    vider(s);
    s.appendChild(el('option', { value: '', text: 'Toutes les catégories' }));
    etat.categories.forEach(function (c) { s.appendChild(el('option', { value: String(c.id), text: c.name })); });
    if (etat.categories.some(function (c) { return String(c.id) === etat.filtre; })) s.value = etat.filtre; else etat.filtre = '';
  }

  function carte(p) {
    var img = el('img', { class: 'plat-img', src: p.photoUrl || PLACEHOLDER, alt: '', width: '110', height: '82', loading: 'lazy' });
    var dispo = el('button', {
      type: 'button',
      class: 'btn btn-dispo',
      'aria-pressed': String(p.available),
      'aria-label': p.name + ' : ' + (p.available ? 'disponible. Appuyer pour le marquer épuisé.' : 'épuisé. Appuyer pour le remettre à la carte.'),
      text: p.available ? 'Disponible' : 'Épuisé'
    });
    dispo.addEventListener('click', function () { basculerDispo(p, dispo); });
    var modifier = el('button', { type: 'button', class: 'btn btn-contour', 'aria-label': 'Modifier ' + p.name, text: 'Modifier' });
    modifier.addEventListener('click', function () { ouvrirPlat(p); });

    var corps = el('div', {}, [
      el('h2', { text: p.name }),
      el('p', { class: 'plat-meta' }, [document.createTextNode(nomCategorie(p.categoryId) + ' · '), el('span', { class: 'plat-prix', text: prix(p.price) })])
    ]);
    var li = el('li', { class: 'plat' + (p.available ? '' : ' epuise') }, [img, corps, el('div', { class: 'plat-actions' }, [dispo, modifier])]);
    return li;
  }

  function rendrePlats() {
    var liste = $('liste-plats');
    vider(liste);
    var vus = etat.plats.filter(function (p) { return !etat.filtre || String(p.categoryId) === etat.filtre; });
    $('plats-etat').textContent = vus.length
      ? vus.length + ' plat' + (vus.length > 1 ? 's' : '')
      : 'Aucun plat dans cette catégorie. Ajoutez-en un.';
    vus.forEach(function (p) { liste.appendChild(carte(p)); });
  }

  function basculerDispo(p, bouton) {
    if (etat.occupe) return;
    etat.occupe = true;
    bouton.disabled = true;
    api('PUT', '/plats/' + p.id, { json: { available: !p.available } }).then(function (rep) {
      etat.occupe = false;
      if (rep.status !== 200) { bouton.disabled = false; toast(messageErreur(rep), true); return; }
      toast(rep.corps.name + ' : ' + (rep.corps.available ? 'de nouveau disponible' : 'marqué épuisé'));
      return chargerPlats();
    });
  }

  /* ---------- Fenêtre : plat ---------- */

  function liberer() { if (etat.aperçuUrl) { URL.revokeObjectURL(etat.aperçuUrl); etat.aperçuUrl = null; } }

  function ouvrirPlat(plat) {
    var f = $('form-plat');
    f.reset();
    ['plat-nom', 'plat-desc', 'plat-prix', 'plat-cat'].forEach(function (id) { erreurChamp(id, ''); });
    $('plat-photo-erreur').hidden = true;
    alerte('plat-erreur', '');
    liberer();
    etat.platEdite = plat;
    etat.photoBlob = null;
    etat.photoRetiree = false;

    var sel = $('plat-cat');
    vider(sel);
    etat.categories.forEach(function (c) { sel.appendChild(el('option', { value: String(c.id), text: c.name })); });

    $('plat-titre').textContent = plat ? 'Modifier le plat' : 'Ajouter un plat';
    $('plat-nom').value = plat ? plat.name : '';
    $('plat-desc').value = plat ? plat.description : '';
    $('plat-prix').value = plat ? String(plat.price) : '';
    sel.value = plat ? String(plat.categoryId) : (etat.filtre || (etat.categories[0] ? String(etat.categories[0].id) : ''));
    $('plat-dispo').checked = plat ? plat.available : true;
    $('plat-apercu').src = plat && plat.photoUrl ? plat.photoUrl : PLACEHOLDER;
    $('btn-retirer-photo').hidden = !(plat && plat.photoUrl && /^\/uploads\//.test(plat.photoUrl));
    $('btn-supprimer-plat').hidden = !plat;
    $('dlg-plat').showModal();
  }

  // Réduit la photo à 1200 px et la ré-encode en JPEG : plus léger, et les métadonnées (position GPS...) disparaissent
  function preparerImage(fichier) {
    if (!/^image\/(jpeg|png|webp)$/.test(fichier.type)) return Promise.reject(new Error('Choisissez une photo JPEG, PNG ou WebP.'));
    return createImageBitmap(fichier).then(function (img) {
      var ratio = Math.min(1, 1200 / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * ratio));
      c.height = Math.max(1, Math.round(img.height * ratio));
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; // les PNG transparents deviennent blancs
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (img.close) img.close();
      return new Promise(function (ok, ko) {
        c.toBlob(function (b) { if (b) ok(b); else ko(new Error('Cette photo n’a pas pu être préparée.')); }, 'image/jpeg', 0.85);
      });
    }, function () { throw new Error('Cette image ne peut pas être lue. Essayez une photo JPEG ou PNG.'); });
  }

  function erreursPlat(map, genérale) {
    var champs = { name: 'plat-nom', description: 'plat-desc', price: 'plat-prix', categoryId: 'plat-cat' };
    var premier = null;
    Object.keys(champs).forEach(function (k) {
      erreurChamp(champs[k], map && map[k] ? map[k] : '');
      if (map && map[k] && !premier) premier = $(champs[k]);
    });
    if (map && map.available) alerte('plat-erreur', map.available);
    else if (genérale) alerte('plat-erreur', genérale);
    else alerte('plat-erreur', premier ? 'Corrigez les champs indiqués.' : '');
    if (premier) premier.focus(); else if (genérale || (map && map.available)) $('plat-erreur').focus();
  }

  function enregistrerPlat(e) {
    e.preventDefault();
    if (etat.occupe) return;
    var texte = $('plat-prix').value.replace(/\s/g, '');
    var erreurs = {};
    if (!/^\d{1,7}$/.test(texte)) erreurs.price = 'Entrez le prix en francs CFA, en chiffres, sans virgule.';
    if (!$('plat-nom').value.trim()) erreurs.name = 'Indiquez le nom du plat.';
    if (Object.keys(erreurs).length) { erreursPlat(erreurs); return; }

    var donnees = {
      name: $('plat-nom').value.trim(),
      description: $('plat-desc').value.trim(),
      price: Number(texte),
      categoryId: Number($('plat-cat').value),
      available: $('plat-dispo').checked
    };
    var edition = etat.platEdite;
    var bouton = $('btn-enregistrer-plat');
    etat.occupe = true;
    bouton.disabled = true;
    bouton.textContent = 'Enregistrement…';

    var requete = edition ? api('PUT', '/plats/' + edition.id, { json: donnees }) : api('POST', '/plats', { json: donnees });
    requete.then(function (rep) {
      if (rep.status !== 200 && rep.status !== 201) { erreursPlat(rep.corps.erreurs, rep.corps.erreurs ? '' : messageErreur(rep)); return null; }
      var plat = rep.corps;
      if (etat.photoBlob) {
        return api('PUT', '/plats/' + plat.id + '/photo', { blob: etat.photoBlob }).then(function (r2) {
          if (r2.status !== 200) toast('Plat enregistré, mais la photo n’a pas été envoyée : ' + messageErreur(r2), true);
          return plat;
        });
      }
      if (etat.photoRetiree && edition) return api('DELETE', '/plats/' + plat.id + '/photo').then(function () { return plat; });
      return plat;
    }).then(function (plat) {
      etat.occupe = false;
      bouton.disabled = false;
      bouton.textContent = 'Enregistrer';
      if (!plat) return;
      $('dlg-plat').close();
      toast(edition ? 'Plat modifié' : 'Plat ajouté');
      return chargerPlats();
    });
  }

  function confirmer(titre, texte, libelle) {
    return new Promise(function (resolu) {
      var d = $('dlg-confirm');
      $('confirm-titre').textContent = titre;
      $('confirm-texte').textContent = texte;
      $('confirm-oui').textContent = libelle;
      var fin = function (valeur) {
        $('confirm-oui').removeEventListener('click', oui);
        $('confirm-non').removeEventListener('click', non);
        d.removeEventListener('cancel', non);
        if (d.open) d.close();
        resolu(valeur);
      };
      var oui = function () { fin(true); };
      var non = function () { fin(false); };
      $('confirm-oui').addEventListener('click', oui);
      $('confirm-non').addEventListener('click', non);
      d.addEventListener('cancel', non);
      d.showModal();
      $('confirm-non').focus(); // action sûre par défaut
    });
  }

  function supprimerPlat() {
    var p = etat.platEdite;
    if (!p) return;
    confirmer('Supprimer ce plat ?', '« ' + p.name + ' » sera retiré du menu, avec sa photo. Cette action est définitive.', 'Supprimer').then(function (oui) {
      if (!oui) return;
      api('DELETE', '/plats/' + p.id).then(function (rep) {
        if (rep.status !== 200) { toast(messageErreur(rep), true); return; }
        $('dlg-plat').close();
        toast('Plat supprimé');
        chargerPlats();
      });
    });
  }

  /* ---------- Catégories ---------- */

  function rendreCategories() {
    var liste = $('liste-categories');
    vider(liste);
    etat.categories.forEach(function (c) {
      var renommer = el('button', { type: 'button', class: 'btn btn-contour', 'aria-label': 'Renommer ' + c.name, text: 'Renommer' });
      renommer.addEventListener('click', function () { ouvrirCategorie(c); });
      var sup = el('button', { type: 'button', class: 'btn btn-danger', 'aria-label': 'Supprimer ' + c.name, text: 'Supprimer' });
      if (c.nbPlats > 0) { sup.disabled = true; sup.setAttribute('title', 'Contient des plats : déplacez-les ou supprimez-les d’abord.'); }
      sup.addEventListener('click', function () { supprimerCategorie(c); });
      liste.appendChild(el('li', {}, [
        el('div', {}, [el('p', { class: 'nom', text: c.name }), el('p', { class: 'nb', text: c.nbPlats + ' plat' + (c.nbPlats > 1 ? 's' : '') })]),
        el('div', { class: 'actions' }, [renommer, sup])
      ]));
    });
  }

  function ajouterCategorie(e) {
    e.preventDefault();
    var nom = $('categorie-nom').value.trim();
    if (!nom) { erreurChamp('categorie', ''); $('categorie-erreur').textContent = 'Indiquez le nom de la catégorie.'; $('categorie-erreur').hidden = false; $('categorie-nom').focus(); return; }
    api('POST', '/categories', { json: { name: nom } }).then(function (rep) {
      if (rep.status !== 201) {
        var m = (rep.corps.erreurs && rep.corps.erreurs.name) || messageErreur(rep);
        $('categorie-erreur').textContent = m; $('categorie-erreur').hidden = false; $('categorie-nom').setAttribute('aria-invalid', 'true');
        return;
      }
      $('categorie-nom').value = '';
      $('categorie-erreur').hidden = true; $('categorie-nom').removeAttribute('aria-invalid');
      toast('Catégorie ajoutée');
      return chargerPlats();
    });
  }

  function ouvrirCategorie(c) {
    etat.catEditee = c;
    $('cat-nom').value = c.name;
    erreurChamp('cat', '');
    $('dlg-cat').showModal();
  }

  function enregistrerCategorie(e) {
    e.preventDefault();
    var c = etat.catEditee;
    api('PUT', '/categories/' + c.id, { json: { name: $('cat-nom').value.trim() } }).then(function (rep) {
      if (rep.status !== 200) {
        var m = (rep.corps.erreurs && rep.corps.erreurs.name) || messageErreur(rep);
        $('cat-erreur').textContent = m; $('cat-erreur').hidden = false; $('cat-nom').setAttribute('aria-invalid', 'true');
        return;
      }
      $('dlg-cat').close();
      toast('Catégorie renommée');
      return chargerPlats();
    });
  }

  function supprimerCategorie(c) {
    confirmer('Supprimer cette catégorie ?', '« ' + c.name + ' » sera supprimée.', 'Supprimer').then(function (oui) {
      if (!oui) return;
      api('DELETE', '/categories/' + c.id).then(function (rep) {
        if (rep.status !== 200) { toast(messageErreur(rep), true); return; }
        toast('Catégorie supprimée');
        chargerPlats();
      });
    });
  }

  /* ---------- Commandes ---------- */

  function quand(pour) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(pour || '');
    if (!m) return pour || '';
    var jour = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    var h = +m[4];
    var min = m[5] === '00' ? '' : m[5];
    return jour + ' à ' + h + 'h' + min;
  }

  function recue(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('fr-FR', { timeZone: 'Africa/Douala', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function chargerCommandes() {
    $('commandes-etat').textContent = 'Chargement…';
    return api('GET', '/commandes').then(function (rep) {
      if (rep.status !== 200) { $('commandes-etat').textContent = messageErreur(rep, 'Impossible de charger les commandes.'); return; }
      etat.commandes = rep.corps.commandes;
      var liste = $('liste-commandes');
      vider(liste);
      $('commandes-etat').textContent = etat.commandes.length
        ? 'Les ' + etat.commandes.length + ' commande' + (etat.commandes.length > 1 ? 's' : '') + ' les plus récentes. Rappelez chaque client pour confirmer.'
        : 'Aucune commande pour le moment.';
      etat.commandes.forEach(function (c) {
        var lignes = el('ul', {}, c.lignes.map(function (l) { return el('li', { text: l.qty + ' × ' + l.name + ' (' + prix(l.prixUnitaire * l.qty) + ')' }); }));
        var tel = String(c.tel || '').replace(/[^\d+]/g, '');
        var badges = [el('span', { class: 'badge', text: STATUTS[c.status] || c.status })];
        if (!c.emailEnvoye) badges.push(el('span', { class: 'badge badge-alerte', text: 'Email non envoyé' }));
        liste.appendChild(el('li', { class: 'commande' }, [
          el('div', { class: 'commande-tete' }, [el('h2', { text: c.reference }), el('div', {}, badges)]),
          el('p', { text: 'Pour le ' + quand(c.pour) }),
          el('p', {}, [document.createTextNode(c.nom + ' · '), el('a', { href: 'tel:' + tel, text: c.tel })]),
          lignes,
          el('p', { class: 'total', text: prix(c.total) }),
          el('p', { class: 'plat-meta', text: 'Reçue le ' + recue(c.creeLe) })
        ]));
      });
    });
  }

  /* ---------- Connexion, mot de passe ---------- */

  function connexion(e) {
    e.preventDefault();
    var id = $('identifiant').value.trim();
    var mdp = $('motdepasse').value;
    if (!id || !mdp) { alerte('connexion-erreur', 'Entrez votre identifiant et votre mot de passe.'); $('connexion-erreur').focus(); return; }
    var b = $('btn-connexion');
    b.disabled = true; b.textContent = 'Connexion…';
    api('POST', '/login', { json: { identifiant: id, motDePasse: mdp } }).then(function (rep) {
      b.disabled = false; b.textContent = 'Se connecter';
      if (rep.status !== 200) {
        $('motdepasse').value = '';
        alerte('connexion-erreur', messageErreur(rep, 'Connexion impossible.'));
        $('connexion-erreur').focus();
        return;
      }
      $('motdepasse').value = '';
      alerte('connexion-erreur', '');
      etat.csrf = rep.corps.csrf;
      etat.doitChanger = !!rep.corps.doitChangerMotDePasse;
      montrerApp();
    });
  }

  function changerMotDePasse(e) {
    e.preventDefault();
    var actuel = $('mdp-actuel').value;
    var nouveau = $('mdp-nouveau').value;
    erreurChamp('mdp-actuel', ''); erreurChamp('mdp-nouveau', ''); erreurChamp('mdp-confirmer', '');
    alerte('mdp-erreur', '');
    var premier = null;
    if (!actuel) { erreurChamp('mdp-actuel', 'Entrez votre mot de passe actuel.'); premier = premier || $('mdp-actuel'); }
    if (!nouveau) { erreurChamp('mdp-nouveau', 'Choisissez un nouveau mot de passe.'); premier = premier || $('mdp-nouveau'); }
    else if (nouveau !== $('mdp-confirmer').value) { erreurChamp('mdp-confirmer', 'Les deux mots de passe ne sont pas identiques.'); premier = premier || $('mdp-confirmer'); }
    if (premier) { premier.focus(); return; }

    var b = $('btn-mdp');
    b.disabled = true; b.textContent = 'Enregistrement…';
    api('POST', '/mot-de-passe', { json: { actuel: actuel, nouveau: nouveau } }).then(function (rep) {
      b.disabled = false; b.textContent = 'Enregistrer le mot de passe';
      if (rep.status !== 200) {
        var er = rep.corps.erreurs || {};
        if (er.actuel) erreurChamp('mdp-actuel', er.actuel);
        if (er.nouveau) erreurChamp('mdp-nouveau', er.nouveau);
        if (!er.actuel && !er.nouveau) { alerte('mdp-erreur', messageErreur(rep)); $('mdp-erreur').focus(); }
        else $(er.actuel ? 'mdp-actuel' : 'mdp-nouveau').focus();
        return;
      }
      ['mdp-actuel', 'mdp-nouveau', 'mdp-confirmer'].forEach(function (id) { $(id).value = ''; });
      var etaitTemporaire = etat.doitChanger;
      etat.doitChanger = false;
      toast('Mot de passe enregistré');
      if (etaitTemporaire) { etat.onglet = 'plats'; montrerApp(); }
    });
  }

  function deconnexion() {
    api('POST', '/logout').then(function () { montrerConnexion(''); });
  }

  /* ---------- Branchements ---------- */

  $('form-connexion').addEventListener('submit', connexion);
  $('afficher-mdp').addEventListener('change', function () { $('motdepasse').type = this.checked ? 'text' : 'password'; });
  $('afficher-mdp2').addEventListener('change', function () {
    var t = this.checked ? 'text' : 'password';
    ['mdp-actuel', 'mdp-nouveau', 'mdp-confirmer'].forEach(function (id) { $(id).type = t; });
  });
  $('btn-deconnexion').addEventListener('click', deconnexion);
  $('onglets').addEventListener('click', function (e) {
    var b = e.target.closest('.onglet');
    if (b && !b.disabled) afficherOnglet(b.getAttribute('data-onglet'));
  });

  $('filtre-categorie').addEventListener('change', function () { etat.filtre = this.value; rendrePlats(); });
  $('btn-nouveau-plat').addEventListener('click', function () { ouvrirPlat(null); });
  $('form-plat').addEventListener('submit', enregistrerPlat);
  $('btn-annuler-plat').addEventListener('click', function () { $('dlg-plat').close(); });
  $('btn-supprimer-plat').addEventListener('click', supprimerPlat);
  $('dlg-plat').addEventListener('close', liberer);

  $('plat-photo').addEventListener('change', function () {
    var fichier = this.files && this.files[0];
    etat.photoBlob = null;
    $('plat-photo-erreur').hidden = true;
    if (!fichier) return;
    preparerImage(fichier).then(function (blob) {
      liberer();
      etat.photoBlob = blob;
      etat.photoRetiree = false;
      etat.aperçuUrl = URL.createObjectURL(blob);
      $('plat-apercu').src = etat.aperçuUrl;
    }, function (err) {
      $('plat-photo').value = '';
      $('plat-photo-erreur').textContent = err.message;
      $('plat-photo-erreur').hidden = false;
    });
  });
  $('btn-retirer-photo').addEventListener('click', function () {
    etat.photoRetiree = true;
    etat.photoBlob = null;
    $('plat-photo').value = '';
    liberer();
    $('plat-apercu').src = PLACEHOLDER;
    $('btn-retirer-photo').hidden = true;
  });

  $('form-categorie').addEventListener('submit', ajouterCategorie);
  $('form-cat').addEventListener('submit', enregistrerCategorie);
  $('btn-annuler-cat').addEventListener('click', function () { $('dlg-cat').close(); });
  $('btn-actualiser').addEventListener('click', chargerCommandes);
  $('form-mdp').addEventListener('submit', changerMotDePasse);

  /* ---------- Démarrage ---------- */

  api('GET', '/session').then(function (rep) {
    if (rep.status === 200 && rep.corps.connecte) {
      etat.csrf = rep.corps.csrf;
      etat.doitChanger = !!rep.corps.doitChangerMotDePasse;
      montrerApp();
    } else {
      montrerConnexion('');
    }
  });
})();
