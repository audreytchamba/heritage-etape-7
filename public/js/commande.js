// Page Commande (version A) : valide le formulaire et ouvre WhatsApp avec le message pré-rempli.
// Rien n'est envoyé à notre serveur : c'est le restaurant qui confirme la commande par WhatsApp.
// Tout le texte affiché est inséré avec textContent (jamais innerHTML).
(function () {
  var formatPrixBrut = new Intl.NumberFormat('fr-FR');
  function prix(n) { return formatPrixBrut.format(n).replace(/[  ]/g, ' ') + ' FCFA'; }

  var config = null;

  var etat = document.getElementById('commande-etat');
  var contenu = document.getElementById('commande-contenu');
  var recapListe = document.getElementById('recap-liste');
  var recapTotal = document.getElementById('recap-total');
  var form = document.getElementById('formulaire');
  var erreurs = document.getElementById('erreurs');
  var envoye = document.getElementById('envoye');
  var champs = {
    nom: document.getElementById('nom'),
    tel: document.getElementById('tel'),
    date: document.getElementById('date'),
    heure: document.getElementById('heure')
  };
  var aideHeure = document.getElementById('heure-aide');
  var boutonPrincipal = document.getElementById('envoyer-principal');
  var boutonWhatsApp = document.getElementById('envoyer-whatsapp');
  var noteEnvoi = document.getElementById('note-envoi');
  var confirmation = document.getElementById('confirmation');

  var modes = ['whatsapp']; // remplacé par la configuration du serveur
  var envoiEnCours = false;
  var envoyee = false;      // une fois la commande envoyée, on n'affiche plus le formulaire

  /* ---------- Outils ---------- */

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

  function enMinutes(hhmm) {
    var p = hhmm.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  function formatHeure(minutes) {
    var m = ((minutes % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60);
    var reste = m % 60;
    if (h === 0 && reste === 0) return 'minuit';
    return h + 'h' + (reste ? String(reste).padStart(2, '0') : '');
  }

  function dateEnMinutes(iso, hhmm) {
    var p = iso.split('-').map(Number);
    var h = hhmm ? hhmm.split(':').map(Number) : [0, 0];
    return Date.UTC(p[0], p[1] - 1, p[2], h[0], h[1]) / 60000;
  }

  function jourSemaine(iso) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  }

  function isoDepuisMinutes(minutes) {
    return new Date(minutes * 60000).toISOString().slice(0, 10);
  }

  // Date et heure actuelles à Yaoundé, quel que soit le fuseau du téléphone
  function maintenant() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    var iso = o.year + '-' + o.month + '-' + o.day;
    return { iso: iso, minutes: dateEnMinutes(iso, o.hour + ':' + o.minute) };
  }

  function texteHoraires(iso) {
    var h = config.horaires[jourSemaine(iso)];
    return formatHeure(enMinutes(h.ouvre)) + ' à ' + formatHeure(enMinutes(h.ferme));
  }

  /* ---------- Validation ---------- */

  function validerNom(valeur) {
    var nom = valeur.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (nom.length < 2) return { erreur: 'Indiquez votre nom (au moins 2 lettres).' };
    if (nom.length > 80) return { erreur: 'Votre nom est trop long (80 caractères au maximum).' };
    if (!/\p{L}/u.test(nom)) return { erreur: 'Votre nom doit contenir des lettres.' };
    return { valeur: nom };
  }

  function validerTel(valeur) {
    var n = valeur.replace(/[\s.\-()]/g, '');
    if (n.indexOf('+') === 0) n = n.slice(1);
    if (n.indexOf('00237') === 0) n = n.slice(2);
    if (n.indexOf('237') === 0 && n.length === 12) n = n.slice(3);
    if (!/^[26]\d{8}$/.test(n)) {
      return { erreur: 'Numéro non valide. Entrez 9 chiffres commençant par 6 ou 2, par exemple 6 59 85 56 17.' };
    }
    var joli = '+237 ' + n[0] + ' ' + n.slice(1).match(/.{2}/g).join(' ');
    return { valeur: joli };
  }

  function validerDate(iso) {
    if (!iso) return { erreur: 'Choisissez un jour.' };
    var now = maintenant();
    if (iso < now.iso) return { erreur: 'Ce jour est passé. Choisissez aujourd’hui ou un jour à venir.' };
    var ecart = (dateEnMinutes(iso) - dateEnMinutes(now.iso)) / 1440;
    if (ecart > config.joursMax) return { erreur: 'Vous pouvez commander jusqu’à ' + config.joursMax + ' jours à l’avance.' };
    return { valeur: iso };
  }

  function validerHeure(iso, hhmm) {
    if (!hhmm) return { erreur: 'Choisissez une heure.' };
    if (!iso) return { erreur: 'Choisissez d’abord un jour.' };
    var now = maintenant();
    var requis = dateEnMinutes(iso, hhmm);

    // Ouvert ce jour-là, ou encore dans le service de la veille (fermeture après minuit)
    var ouvert = false;
    [0, -1].forEach(function (k) {
      var base = dateEnMinutes(iso) + k * 1440;
      var h = config.horaires[(jourSemaine(iso) + k + 7) % 7];
      var ouvre = base + enMinutes(h.ouvre);
      var ferme = base + enMinutes(h.ferme);
      if (ferme <= ouvre) ferme += 1440;
      if (requis >= ouvre && requis < ferme) ouvert = true;
    });
    if (!ouvert) return { erreur: 'Le restaurant est fermé à cette heure. Ce jour-là : ' + texteHoraires(iso) + '.' };

    if (requis - now.minutes < config.delaiMinimum) {
      return { erreur: 'Choisissez une heure au moins ' + config.delaiMinimum + ' minutes après maintenant.' };
    }
    return { valeur: hhmm };
  }

  /* ---------- Affichage des erreurs ---------- */

  function montrerErreur(nom, message) {
    var p = document.getElementById(nom + '-err');
    var input = champs[nom];
    if (message) {
      p.textContent = message;
      p.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    } else {
      p.textContent = '';
      p.hidden = true;
      input.removeAttribute('aria-invalid');
    }
  }

  /* ---------- Message WhatsApp ---------- */

  function construireMessage(lignes, total, nom, tel, iso, hhmm) {
    var jour = new Date(dateEnMinutes(iso) * 60000).toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    });
    var l = ['Bonjour Heritage, je souhaite commander :'];
    lignes.forEach(function (x) { l.push('- ' + x.qty + ' x ' + x.name + ' (' + prix(x.price * x.qty) + ')'); });
    l.push('Total : ' + prix(total));
    l.push('');
    l.push('Nom : ' + nom);
    l.push('Téléphone : ' + tel);
    l.push('Pour le : ' + jour + ' à ' + formatHeure(enMinutes(hhmm)));
    return l.join('\n');
  }

  /* ---------- Récapitulatif et états ---------- */

  function afficherEtat(texte, avecBouton) {
    contenu.hidden = true;
    etat.hidden = false;
    etat.textContent = texte;
    if (avecBouton) {
      etat.appendChild(document.createElement('br'));
      etat.appendChild(avecBouton);
    }
  }

  function rendre() {
    if (envoyee) return;
    var panier = window.HeritagePanier;
    if (!config || !panier) {
      afficherEtat('Chargement de votre panier');
      return;
    }
    if (panier.erreur()) {
      var r = el('button', { type: 'button', class: 'btn btn-braise', text: 'Réessayer' });
      r.addEventListener('click', function () { location.reload(); });
      afficherEtat('Impossible de charger votre panier. Vérifiez votre connexion, puis réessayez.', r);
      return;
    }
    if (!panier.pret()) {
      afficherEtat('Chargement de votre panier');
      return;
    }
    var lignes = panier.lignes();
    if (!lignes.length) {
      afficherEtat('Votre panier est vide. Choisissez d’abord des plats dans le menu.',
        el('a', { class: 'btn btn-braise', href: '/menu.html', text: 'Voir le menu' }));
      return;
    }

    etat.hidden = true;
    contenu.hidden = false;
    recapListe.textContent = '';
    lignes.forEach(function (x) {
      recapListe.appendChild(el('li', {}, [
        el('span', { class: 'recap-nom' }, [document.createTextNode(x.name + ' '), el('span', { text: '× ' + x.qty })]),
        el('span', { class: 'recap-prix', text: prix(x.price * x.qty) })
      ]));
    });
    recapTotal.textContent = prix(panier.total());
  }

  /* ---------- Initialisation ---------- */

  function aideHoraire() {
    var iso = champs.date.value;
    aideHeure.textContent = iso && !validerDate(iso).erreur ? 'Ce jour-là : ' + texteHoraires(iso) : '';
  }

  function configurerBoutons() {
    modes = config.modesCommande && config.modesCommande.length ? config.modesCommande : ['whatsapp'];
    var email = modes[0] === 'email';
    boutonPrincipal.textContent = email ? 'Envoyer ma commande' : 'Envoyer ma commande sur WhatsApp';
    boutonWhatsApp.hidden = !(email && modes.indexOf('whatsapp') !== -1);
    noteEnvoi.textContent = email
      ? 'Le restaurant reçoit votre commande tout de suite et vous appelle au numéro indiqué pour la confirmer. Aucun paiement n’est demandé en ligne.'
      : 'Votre commande n’est confirmée que lorsque le restaurant vous répond sur WhatsApp. Aucun paiement n’est demandé en ligne.';
  }

  function preparerChamps() {
    configurerBoutons();
    var now = maintenant();
    champs.date.min = now.iso;
    champs.date.max = isoDepuisMinutes(dateEnMinutes(now.iso) + config.joursMax * 1440);
  }

  champs.date.addEventListener('change', function () {
    aideHoraire();
    montrerErreur('date', validerDate(champs.date.value).erreur || '');
    if (champs.heure.value) montrerErreur('heure', validerHeure(champs.date.value, champs.heure.value).erreur || '');
  });
  champs.heure.addEventListener('change', function () {
    montrerErreur('heure', validerHeure(champs.date.value, champs.heure.value).erreur || '');
  });
  champs.nom.addEventListener('blur', function () { if (champs.nom.value) montrerErreur('nom', validerNom(champs.nom.value).erreur || ''); });
  champs.tel.addEventListener('blur', function () { if (champs.tel.value) montrerErreur('tel', validerTel(champs.tel.value).erreur || ''); });

  function traiter(mode) {
    if (envoiEnCours) return;
    var panier = window.HeritagePanier;
    var lignes = panier ? panier.lignes() : [];
    if (!lignes.length) { rendre(); return; }

    var rNom = validerNom(champs.nom.value);
    var rTel = validerTel(champs.tel.value);
    var rDate = validerDate(champs.date.value);
    var rHeure = rDate.erreur ? { erreur: 'Choisissez d’abord un jour valide.' } : validerHeure(champs.date.value, champs.heure.value);

    var resultats = [['nom', rNom], ['tel', rTel], ['date', rDate], ['heure', rHeure]];
    var premier = null;
    var nb = 0;
    resultats.forEach(function (x) {
      montrerErreur(x[0], x[1].erreur || '');
      if (x[1].erreur) { nb += 1; if (!premier) premier = champs[x[0]]; }
    });

    if (nb) {
      erreurs.textContent = nb === 1 ? 'Un champ est à corriger avant d’envoyer.' : nb + ' champs sont à corriger avant d’envoyer.';
      erreurs.hidden = false;
      premier.focus();
      return;
    }
    erreurs.hidden = true;

    var valeurs = { nom: rNom.valeur, tel: rTel.valeur, date: rDate.valeur, heure: rHeure.valeur, lignes: lignes, total: panier.total() };
    if (mode === 'email') envoyerEmail(valeurs); else envoyerWhatsApp(valeurs);
  }

  function lienWhatsApp(val, total) {
    var message = construireMessage(val.lignes, total, val.nom, val.tel, val.date, val.heure);
    return 'https://wa.me/' + config.whatsapp + '?text=' + encodeURIComponent(message);
  }

  /* Version A : WhatsApp */
  function envoyerWhatsApp(val) {
    var url = lienWhatsApp(val, val.total);
    document.getElementById('lien-whatsapp').href = url;
    window.open(url, '_blank', 'noopener');
    envoye.hidden = false;
    var titre = document.getElementById('envoye-titre');
    titre.setAttribute('tabindex', '-1');
    titre.focus();
  }

  /* Version B : email envoyé à l'administrateur par notre serveur */
  function erreurGlobale(texte) {
    erreurs.textContent = texte;
    erreurs.hidden = false;
    erreurs.focus();
  }

  function erreursDuServeur(map) {
    var premier = null;
    ['nom', 'tel', 'date', 'heure'].forEach(function (k) {
      montrerErreur(k, map[k] || '');
      if (map[k] && !premier) premier = champs[k];
    });
    if (map.lignes) {
      erreurGlobale(map.lignes + ' Actualisez la page pour mettre votre panier à jour.');
    } else {
      erreurs.textContent = 'Corrigez les champs indiqués avant d’envoyer.';
      erreurs.hidden = false;
      if (premier) premier.focus();
    }
  }

  function libelleQuand(iso, hhmm) {
    var jour = new Date(dateEnMinutes(iso) * 60000).toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    });
    return jour + ' à ' + formatHeure(enMinutes(hhmm));
  }

  function succes(val, rep) {
    envoyee = true;
    etat.hidden = true;
    contenu.hidden = true;
    var quand = libelleQuand(val.date, val.heure);
    var alerte = document.getElementById('confirmation-alerte');
    var lienWa = document.getElementById('confirmation-whatsapp');

    if (rep.notifie) {
      document.getElementById('confirmation-texte').textContent =
        'Merci, ' + val.nom + '. Votre commande ' + rep.reference + ' (' + prix(rep.total) + ') pour le ' + quand +
        ' a été transmise au restaurant. Il vous appellera au ' + val.tel + ' pour la confirmer.';
      alerte.hidden = true;
      lienWa.hidden = true;
    } else {
      document.getElementById('confirmation-texte').textContent =
        'Merci, ' + val.nom + '. Votre commande ' + rep.reference + ' (' + prix(rep.total) + ') pour le ' + quand + ' est enregistrée.';
      alerte.textContent = 'Le restaurant n’a pas pu être prévenu automatiquement. Pour être sûr d’être servi, envoyez aussi votre commande par WhatsApp.';
      alerte.hidden = false;
      lienWa.href = lienWhatsApp(val, rep.total);
      lienWa.hidden = false;
    }
    confirmation.hidden = false;
    if (window.HeritagePanier) window.HeritagePanier.vider(); // la commande est partie : on vide le panier
    document.getElementById('confirmation-titre').focus();
  }

  function envoyerEmail(val) {
    envoiEnCours = true;
    form.setAttribute('aria-busy', 'true');
    var texteAvant = boutonPrincipal.textContent;
    boutonPrincipal.disabled = true;
    boutonWhatsApp.disabled = true;
    boutonPrincipal.textContent = 'Envoi en cours';

    var ctrl = new AbortController();
    var delai = setTimeout(function () { ctrl.abort(); }, 20000);

    fetch('/api/commandes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        nom: val.nom,
        tel: val.tel,
        date: val.date,
        heure: val.heure,
        // Seuls l'identifiant et la quantité partent : le serveur recalcule les prix
        lignes: val.lignes.map(function (l) { return { id: l.id, qty: l.qty }; }),
        site: document.getElementById('site').value
      })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (json) { return { status: r.status, json: json }; });
      })
      .then(function (rep) {
        if (rep.status === 201 && rep.json.ok) return succes(val, rep.json);
        if (rep.status === 400 && rep.json.erreurs) return erreursDuServeur(rep.json.erreurs);
        erreurGlobale((rep.json && rep.json.erreur) || 'La commande n’a pas pu être envoyée. Réessayez, ou utilisez WhatsApp.');
      })
      .catch(function () {
        erreurGlobale('Connexion impossible. Vérifiez votre réseau, puis réessayez, ou utilisez WhatsApp.');
      })
      .then(function () {
        clearTimeout(delai);
        envoiEnCours = false;
        form.removeAttribute('aria-busy');
        boutonPrincipal.disabled = false;
        boutonWhatsApp.disabled = false;
        boutonPrincipal.textContent = texteAvant;
      });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); traiter(modes[0]); });
  boutonWhatsApp.addEventListener('click', function () { traiter('whatsapp'); });

  document.getElementById('modifier-panier').addEventListener('click', function () {
    var b = document.querySelector('.panier-bouton');
    if (b) b.click();
  });
  document.getElementById('vider-retour').addEventListener('click', function () {
    if (window.HeritagePanier) window.HeritagePanier.vider();
    location.href = '/menu.html';
  });
  document.addEventListener('panier:change', rendre);

  fetch('/api/config')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (c) { config = c; preparerChamps(); rendre(); })
    .catch(function () {
      var r = el('button', { type: 'button', class: 'btn btn-braise', text: 'Réessayer' });
      r.addEventListener('click', function () { location.reload(); });
      afficherEtat('La page ne se charge pas. Vérifiez votre connexion, puis réessayez.', r);
    });

  rendre();
})();
