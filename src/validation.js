// Validation des commandes côté serveur. Fait foi : ce que le navigateur vérifie
// n'est qu'un confort pour le client, un attaquant peut l'ignorer.
const config = require('./config');

const QTE_MAX = 20;
const LIGNES_MAX = 30;

function enMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function dateEnMinutes(iso, hhmm) {
  const [a, m, j] = iso.split('-').map(Number);
  const [h, mi] = hhmm ? hhmm.split(':').map(Number) : [0, 0];
  return Date.UTC(a, m - 1, j, h, mi) / 60000;
}

function jourSemaine(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j)).getUTCDay();
}

function formatHeure(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  if (h === 0 && reste === 0) return 'minuit';
  return `${h}h${reste ? String(reste).padStart(2, '0') : ''}`;
}

// Date et heure actuelles dans le fuseau du restaurant
function maintenant(date = new Date()) {
  const o = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).forEach((p) => { o[p.type] = p.value; });
  const iso = `${o.year}-${o.month}-${o.day}`;
  return { iso, minutes: dateEnMinutes(iso, `${o.hour}:${o.minute}`) };
}

function texteHoraires(iso) {
  const h = config.horaires[jourSemaine(iso)];
  return `${formatHeure(enMinutes(h.ouvre))} à ${formatHeure(enMinutes(h.ferme))}`;
}

function validerNom(valeur) {
  if (typeof valeur !== 'string') return { erreur: 'Indiquez votre nom.' };
  const nom = valeur.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (nom.length < 2) return { erreur: 'Indiquez votre nom (au moins 2 lettres).' };
  if (nom.length > 80) return { erreur: 'Votre nom est trop long (80 caractères au maximum).' };
  if (!/\p{L}/u.test(nom)) return { erreur: 'Votre nom doit contenir des lettres.' };
  return { valeur: nom };
}

function validerTel(valeur) {
  if (typeof valeur !== 'string' || valeur.length > 30) return { erreur: 'Numéro non valide.' };
  let n = valeur.replace(/[\s.\-()]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  if (n.startsWith('00237')) n = n.slice(2);
  if (n.startsWith('237') && n.length === 12) n = n.slice(3);
  if (!/^[26]\d{8}$/.test(n)) {
    return { erreur: 'Numéro non valide. Entrez 9 chiffres commençant par 6 ou 2, par exemple 6 59 85 56 17.' };
  }
  return { valeur: `+237 ${n[0]} ${n.slice(1).match(/.{2}/g).join(' ')}` };
}

function dateValide(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return new Date(dateEnMinutes(iso) * 60000).toISOString().slice(0, 10) === iso;
}

function validerDate(iso, now = maintenant()) {
  if (!dateValide(iso)) return { erreur: 'Choisissez un jour.' };
  if (iso < now.iso) return { erreur: 'Ce jour est passé. Choisissez aujourd’hui ou un jour à venir.' };
  const ecart = (dateEnMinutes(iso) - dateEnMinutes(now.iso)) / 1440;
  if (ecart > config.joursMax) return { erreur: `Vous pouvez commander jusqu’à ${config.joursMax} jours à l’avance.` };
  return { valeur: iso };
}

function validerHeure(iso, hhmm, now = maintenant()) {
  if (typeof hhmm !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return { erreur: 'Choisissez une heure.' };
  if (!dateValide(iso)) return { erreur: 'Choisissez d’abord un jour valide.' };
  const requis = dateEnMinutes(iso, hhmm);

  // Ouvert ce jour-là, ou encore dans le service de la veille (fermeture après minuit)
  let ouvert = false;
  [0, -1].forEach((k) => {
    const base = dateEnMinutes(iso) + k * 1440;
    const h = config.horaires[(jourSemaine(iso) + k + 7) % 7];
    const ouvre = base + enMinutes(h.ouvre);
    let ferme = base + enMinutes(h.ferme);
    if (ferme <= ouvre) ferme += 1440;
    if (requis >= ouvre && requis < ferme) ouvert = true;
  });
  if (!ouvert) return { erreur: `Le restaurant est fermé à cette heure. Ce jour-là : ${texteHoraires(iso)}.` };

  if (requis - now.minutes < config.delaiMinimum) {
    return { erreur: `Choisissez une heure au moins ${config.delaiMinimum} minutes après maintenant.` };
  }
  return { valeur: hhmm };
}

// Nettoie la liste { id, qty } reçue : entiers, quantités bornées, doublons fusionnés.
function validerLignes(lignes) {
  if (!Array.isArray(lignes) || lignes.length === 0) return { erreur: 'Votre panier est vide.' };
  if (lignes.length > LIGNES_MAX) return { erreur: 'Votre panier contient trop de plats différents.' };
  const parId = new Map();
  for (const l of lignes) {
    if (!l || !Number.isInteger(l.id) || l.id < 1 || !Number.isInteger(l.qty) || l.qty < 1) {
      return { erreur: 'Votre panier contient une ligne non valide.' };
    }
    parId.set(l.id, (parId.get(l.id) || 0) + l.qty);
  }
  const propres = [];
  for (const [id, qty] of parId) {
    if (qty > QTE_MAX) return { erreur: `Vous ne pouvez pas commander plus de ${QTE_MAX} exemplaires du même plat.` };
    propres.push({ id, qty });
  }
  return { valeur: propres };
}

module.exports = {
  QTE_MAX, maintenant, formatHeure, enMinutes, dateEnMinutes,
  validerNom, validerTel, validerDate, validerHeure, validerLignes,
};
