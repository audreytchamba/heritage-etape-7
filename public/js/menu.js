// Page Menu : charge /api/menu, filtre par catégorie, trie par prix.
// Tout le texte venant de la base est inséré avec textContent (jamais innerHTML).
(function () {
  var conteneur = document.getElementById('menu');
  var etat = document.getElementById('menu-etat');
  var zoneFiltres = document.getElementById('filtres');
  var selectTri = document.getElementById('tri');

  var donnees = { categories: [], dishes: [] };
  var filtre = null; // id de catégorie, ou null pour "Tout"
  var tri = 'defaut';

  var formatPrix = new Intl.NumberFormat('fr-FR');

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

  function carte(plat) {
    var photo = el('img', {
      class: 'plat-photo',
      src: plat.photoUrl || '/img/placeholder-plat.svg',
      alt: '',
      loading: 'lazy',
      width: '400',
      height: '300'
    });
    var tete = el('div', { class: 'plat-tete' }, [
      el('h3', { text: plat.name }),
      el('p', { class: 'plat-prix', text: formatPrix.format(plat.price) + ' FCFA' })
    ]);
    var pied = el('div', { class: 'plat-pied' });

    if (plat.available) {
      var bouton = el('button', {
        type: 'button',
        class: 'btn btn-braise btn-petit',
        'data-plat-id': String(plat.id),
        'aria-label': 'Ajouter ' + plat.name + ' au panier',
        text: 'Ajouter au panier'
      });
      bouton.addEventListener('click', function () {
        // Le panier (étape 3) écoute cet événement.
        document.dispatchEvent(new CustomEvent('panier:ajouter', { detail: plat }));
      });
      pied.appendChild(bouton);
    } else {
      pied.appendChild(el('span', { class: 'badge-epuise', text: 'Épuisé' }));
    }

    var li = el('li', { class: 'plat' }, [photo, tete, el('p', { class: 'plat-desc', text: plat.description }), pied]);
    if (!plat.available) li.setAttribute('data-epuise', '');
    return li;
  }

  function groupe(titre, plats) {
    var liste = el('ul', { class: 'plats' }, plats.map(carte));
    return el('section', { class: 'menu-groupe' }, [el('h2', { text: titre }), liste]);
  }

  function afficher() {
    var plats = donnees.dishes.filter(function (d) { return filtre === null || d.categoryId === filtre; });
    conteneur.textContent = '';

    if (!plats.length) {
      conteneur.appendChild(el('p', { class: 'menu-etat', text: 'Aucun plat dans cette catégorie pour le moment.' }));
      return;
    }

    if (tri === 'defaut') {
      donnees.categories.forEach(function (c) {
        var duGroupe = plats.filter(function (d) { return d.categoryId === c.id; });
        if (duGroupe.length) conteneur.appendChild(groupe(c.name, duGroupe));
      });
    } else {
      var tries = plats.slice().sort(function (a, b) { return tri === 'asc' ? a.price - b.price : b.price - a.price; });
      var nomCat = donnees.categories.filter(function (c) { return c.id === filtre; })[0];
      var titre = (nomCat ? nomCat.name : 'Tous les plats') + (tri === 'asc' ? ', du moins cher au plus cher' : ', du plus cher au moins cher');
      conteneur.appendChild(groupe(titre, tries));
    }
  }

  function boutonsFiltres() {
    zoneFiltres.textContent = '';
    var tous = [{ id: null, name: 'Tout' }].concat(donnees.categories);
    tous.forEach(function (c) {
      var b = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(c.id === filtre), text: c.name });
      b.addEventListener('click', function () {
        filtre = c.id;
        Array.prototype.forEach.call(zoneFiltres.children, function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        afficher();
      });
      zoneFiltres.appendChild(b);
    });
  }

  function erreur() {
    conteneur.setAttribute('aria-busy', 'false');
    conteneur.textContent = '';
    var bouton = el('button', { type: 'button', class: 'btn btn-braise', text: 'Réessayer' });
    bouton.addEventListener('click', charger);
    conteneur.appendChild(el('p', { class: 'menu-etat' }, [
      document.createTextNode('Le menu ne s’affiche pas. Vérifiez votre connexion, puis réessayez.'),
      document.createElement('br'),
      bouton
    ]));
  }

  function charger() {
    conteneur.setAttribute('aria-busy', 'true');
    fetch('/api/menu')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) {
        donnees = json;
        boutonsFiltres();
        afficher();
        conteneur.setAttribute('aria-busy', 'false');
      })
      .catch(erreur);
  }

  selectTri.addEventListener('change', function () { tri = selectTri.value; afficher(); });
  charger();
})();
