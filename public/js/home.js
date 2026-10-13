// Statut "ouvert / fermé" calculé à partir du tableau des horaires (source unique : le HTML),
// dans le fuseau horaire de Yaoundé, quelle que soit l'heure du téléphone du visiteur.
(function () {
  var TZ = 'Africa/Douala';
  var JOURS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function maintenantYaounde() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(new Date());
    var out = {};
    parts.forEach(function (p) { out[p.type] = p.value; });
    return { jour: JOURS[out.weekday], minutes: parseInt(out.hour, 10) * 60 + parseInt(out.minute, 10) };
  }

  function enMinutes(hhmm) {
    var p = hhmm.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  function formatHeure(minutes) {
    var m = minutes % 1440;
    var h = Math.floor(m / 60);
    var reste = m % 60;
    if (h === 0 && reste === 0) return 'minuit';
    return h + 'h' + (reste ? String(reste).padStart(2, '0') : '');
  }

  var lignes = document.querySelectorAll('.horaires tr[data-jour]');
  var horaires = {};
  lignes.forEach(function (tr) {
    var ouvre = enMinutes(tr.dataset.ouvre);
    var ferme = enMinutes(tr.dataset.ferme);
    if (ferme <= ouvre) ferme += 1440; // fermeture après minuit
    horaires[tr.dataset.jour] = { ouvre: ouvre, ferme: ferme };
  });

  var now = maintenantYaounde();
  var statut = document.getElementById('statut');
  var texte = document.getElementById('statut-texte');
  if (!statut || !texte || !horaires[now.jour]) return;

  lignes.forEach(function (tr) {
    if (Number(tr.dataset.jour) === now.jour) tr.setAttribute('data-aujourdhui', '');
  });

  var aujourdhui = horaires[now.jour];
  var veille = horaires[(now.jour + 6) % 7];
  var etat = 'ferme';
  var message;

  if (veille && veille.ferme > 1440 && now.minutes < veille.ferme - 1440) {
    etat = 'ouvert';
    message = 'Ouvert maintenant, jusqu’à ' + formatHeure(veille.ferme);
  } else if (now.minutes >= aujourdhui.ouvre && now.minutes < aujourdhui.ferme) {
    etat = 'ouvert';
    message = 'Ouvert maintenant, jusqu’à ' + formatHeure(aujourdhui.ferme);
  } else if (now.minutes < aujourdhui.ouvre) {
    message = 'Fermé pour le moment, ouvre à ' + formatHeure(aujourdhui.ouvre);
  } else {
    var demain = horaires[(now.jour + 1) % 7];
    message = 'Fermé pour ce soir, ouvre demain à ' + formatHeure(demain.ouvre);
  }

  statut.setAttribute('data-etat', etat);
  texte.textContent = message;
})();
