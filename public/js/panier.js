// Panier Heritage : icône fixe + volet (<dialog>), partagé par toutes les pages.
//
// Sécurité : le navigateur ne mémorise que { id, qty }. Noms et prix sont toujours
// relus depuis /api/menu, donc un prix modifié dans le localStorage n'a aucun effet.
// (À l'étape 4/5, le serveur recalculera aussi le total à partir des id et quantités.)
(function () {
  var CLE = 'heritage-panier';
  var QTE_MAX = 20;
  var formatPrix = new Intl.NumberFormat('fr-FR');

  var lignes = lire();          // [{ id, qty }]
  var plats = null;             // { [id]: plat } une fois /api/menu chargé
  var erreurChargement = false;
  var platRetire = false;       // un plat n'est plus au menu ou est épuisé

  /* ---------- Stockage ---------- */

  function lire() {
    try {
      var brut = JSON.parse(localStorage.getItem(CLE) || '[]');
      if (!Array.isArray(brut)) return [];
      var vus = {};
      var propres = [];
      brut.forEach(function (l) {
        if (!l || !Number.isInteger(l.id) || l.id < 1 || !Number.isInteger(l.qty) || l.qty < 1) return;
        if (vus[l.id]) return;
        vus[l.id] = true;
        propres.push({ id: l.id, qty: Math.min(l.qty, QTE_MAX) });
      });
      return propres;
    } catch (e) {
      return [];
    }
  }

  function ecrire() {
    try { localStorage.setItem(CLE, JSON.stringify(lignes)); } catch (e) { /* stockage indisponible */ }
  }

  /* ---------- Données ---------- */

  function nombreArticles() {
    return lignes.reduce(function (s, l) { return s + l.qty; }, 0);
  }

  function detail() {
    // lignes complétées avec nom et prix (seulement si le menu est chargé)
    if (!plats) return [];
    return lignes.map(function (l) {
      var p = plats[l.id];
      return { id: l.id, qty: l.qty, name: p.name, price: p.price };
    });
  }

  function total() {
    return detail().reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  }

  function reconcilier() {
    var avant = lignes.length;
    lignes = lignes.filter(function (l) { return plats[l.id] && plats[l.id].available; });
    if (lignes.length !== avant) { platRetire = true; ecrire(); }
  }

  function charger() {
    erreurChargement = false;
    fetch('/api/menu')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) {
        plats = {};
        json.dishes.forEach(function (d) { plats[d.id] = d; });
        reconcilier();
        majTout();
      })
      .catch(function () { erreurChargement = true; majTout(); });
  }

  /* ---------- Actions ---------- */

  function changerQte(id, delta) {
    lignes.forEach(function (l) {
      if (l.id === id) l.qty = Math.max(1, Math.min(QTE_MAX, l.qty + delta));
    });
    ecrire();
    majTout();
  }

  function retirer(id) {
    lignes = lignes.filter(function (l) { return l.id !== id; });
    ecrire();
    majTout();
  }

  function vider() {
    lignes = [];
    platRetire = false;
    ecrire();
    majTout();
  }

  function ajouter(id) {
    if (!Number.isInteger(id) || id < 1) return;
    if (plats && (!plats[id] || !plats[id].available)) return;
    var ligne = lignes.filter(function (l) { return l.id === id; })[0];
    if (ligne) {
      if (ligne.qty >= QTE_MAX) { annoncer('Quantité maximale atteinte pour ce plat (' + QTE_MAX + ').'); return; }
      ligne.qty += 1;
    } else {
      lignes.push({ id: id, qty: 1 });
    }
    ecrire();
    majTout();
    var nom = plats && plats[id] ? plats[id].name : 'Plat';
    annoncer('Ajouté au panier : ' + nom + '. ' + nombreArticles() + ' article' + (nombreArticles() > 1 ? 's' : '') + '.');
    secouer();
  }

  /* ---------- Interface ---------- */

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

  function iconeSac() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '26');
    svg.setAttribute('height', '26');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var p1 = document.createElementNS(ns, 'path');
    p1.setAttribute('d', 'M5 8h14l-1 12H6L5 8z');
    var p2 = document.createElementNS(ns, 'path');
    p2.setAttribute('d', 'M9 8V6a3 3 0 0 1 6 0v2');
    svg.appendChild(p1);
    svg.appendChild(p2);
    return svg;
  }

  var badge = el('span', { class: 'panier-badge', 'aria-hidden': 'true' });
  var bouton = el('button', { type: 'button', class: 'panier-bouton' }, [iconeSac(), badge]);
  var annonce = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });

  var titre = el('h2', { id: 'panier-titre', text: 'Votre panier' });
  var fermer = el('button', { type: 'button', class: 'panier-fermer', text: 'Fermer' });
  var message = el('p', { class: 'panier-message' });
  var liste = el('ul', { class: 'panier-lignes' });
  var totalValeur = el('strong', { class: 'panier-total-valeur' });
  var commander = el('a', { class: 'btn btn-braise panier-commander', href: '/commande.html', text: 'Commander' });
  var viderBouton = el('button', { type: 'button', class: 'panier-vider', text: 'Vider le panier' });
  var pied = el('div', { class: 'panier-pied' }, [
    el('p', { class: 'panier-total' }, [el('span', { text: 'Total' }), totalValeur]),
    commander,
    viderBouton
  ]);
  var volet = el('dialog', { class: 'panier-volet', 'aria-labelledby': 'panier-titre' }, [
    el('div', { class: 'panier-tete' }, [titre, fermer]),
    el('div', { class: 'panier-corps' }, [message, liste]),
    pied
  ]);

  function annoncer(texte) {
    annonce.textContent = '';
    setTimeout(function () { annonce.textContent = texte; }, 30);
  }

  function secouer() {
    badge.classList.remove('panier-badge-saut');
    void badge.offsetWidth;
    badge.classList.add('panier-badge-saut');
  }

  function ligneDom(l) {
    var moins = el('button', { type: 'button', class: 'qte-btn', 'aria-label': 'Retirer une unité de ' + l.name, text: '−' });
    var plus = el('button', { type: 'button', class: 'qte-btn', 'aria-label': 'Ajouter une unité de ' + l.name, text: '+' });
    if (l.qty <= 1) moins.disabled = true;
    if (l.qty >= QTE_MAX) plus.disabled = true;
    moins.addEventListener('click', function () { changerQte(l.id, -1); });
    plus.addEventListener('click', function () { changerQte(l.id, 1); });

    var retire = el('button', { type: 'button', class: 'panier-retirer', 'aria-label': 'Retirer ' + l.name + ' du panier', text: 'Retirer' });
    retire.addEventListener('click', function () { retirer(l.id); });

    return el('li', { class: 'panier-ligne' }, [
      el('div', { class: 'panier-ligne-info' }, [
        el('p', { class: 'panier-ligne-nom', text: l.name }),
        el('p', { class: 'panier-ligne-prix', text: formatPrix.format(l.price) + ' FCFA l’unité' })
      ]),
      el('div', { class: 'panier-qte' }, [moins, el('span', { class: 'qte-valeur', 'aria-label': 'Quantité', text: String(l.qty) }), plus]),
      el('p', { class: 'panier-ligne-total', text: formatPrix.format(l.price * l.qty) + ' FCFA' }),
      retire
    ]);
  }

  function majTout() {
    var n = nombreArticles();
    document.dispatchEvent(new CustomEvent('panier:change'));
    badge.textContent = String(n);
    badge.hidden = n === 0;
    bouton.setAttribute('aria-label', n === 0 ? 'Ouvrir le panier, vide' : 'Ouvrir le panier, ' + n + ' article' + (n > 1 ? 's' : ''));

    liste.textContent = '';
    message.textContent = '';
    message.hidden = true;
    pied.hidden = true;

    if (erreurChargement && n > 0) {
      message.hidden = false;
      message.textContent = 'Impossible de charger les détails du panier. Vérifiez votre connexion.';
      var r = el('button', { type: 'button', class: 'btn btn-braise btn-petit', text: 'Réessayer' });
      r.addEventListener('click', charger);
      message.appendChild(document.createElement('br'));
      message.appendChild(r);
      return;
    }

    if (platRetire) {
      message.hidden = false;
      message.textContent = 'Un plat n’est plus disponible : il a été retiré de votre panier.';
    }

    if (n === 0) {
      if (!platRetire) {
        message.hidden = false;
        message.textContent = 'Votre panier est vide. Choisissez des plats dans le menu.';
      }
      return;
    }

    if (!plats) {
      message.hidden = false;
      message.textContent = 'Chargement du panier';
      return;
    }

    detail().forEach(function (l) { liste.appendChild(ligneDom(l)); });
    totalValeur.textContent = formatPrix.format(total()) + ' FCFA';
    pied.hidden = false;
  }

  /* ---------- Branchements ---------- */

  bouton.addEventListener('click', function () {
    majTout();
    volet.showModal();
    document.body.style.overflow = 'hidden';
  });
  fermer.addEventListener('click', function () { volet.close(); });
  volet.addEventListener('click', function (e) { if (e.target === volet) volet.close(); }); // clic sur le fond
  volet.addEventListener('close', function () { document.body.style.overflow = ''; platRetire = false; majTout(); });
  viderBouton.addEventListener('click', vider);

  document.addEventListener('panier:ajouter', function (e) {
    var id = e.detail && Number(e.detail.id);
    ajouter(id);
  });

  // Synchronisation entre onglets
  window.addEventListener('storage', function (e) {
    if (e.key === CLE) {
      lignes = lire();
      if (plats) reconcilier();
      majTout();
    }
  });

  document.body.appendChild(bouton);
  document.body.appendChild(volet);
  document.body.appendChild(annonce);
  majTout();
  charger();

  // Petite API pour la page de commande (étape 4)
  window.HeritagePanier = {
    pret: function () { return plats !== null; },
    erreur: function () { return erreurChargement; },
    lignes: function () { return detail(); },
    total: total,
    vider: vider
  };
})();
