// Réglages du restaurant. Peuvent être surchargés par des variables d'environnement.
// Horaires : 0 = dimanche … 6 = samedi. Une fermeture <= ouverture signifie "après minuit".
module.exports = {
  // Numéro WhatsApp au format international, chiffres uniquement (sans + ni espaces)
  whatsapp: (process.env.WHATSAPP_NUMBER || '237659855617').replace(/\D/g, ''),
  timezone: 'Africa/Douala',
  // Délai minimum entre maintenant et l'heure souhaitée, en minutes
  delaiMinimum: 30,
  // On ne peut pas commander plus de N jours à l'avance
  joursMax: 30,
  // Façons de commander proposées sur la page : 'email' (envoi automatique à
  // l'administrateur) et/ou 'whatsapp'. Le premier est le bouton principal.
  // Surcharge possible : ORDER_MODES=whatsapp  ou  ORDER_MODES=email,whatsapp
  modesCommande: (process.env.ORDER_MODES || 'email,whatsapp')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m === 'email' || m === 'whatsapp'),
  // Limitation des envois de commandes par adresse IP
  limiteCommandes: {
    fenetreMs: 10 * 60 * 1000,
    max: Number(process.env.ORDER_RATE_MAX) || 10,
  },
  // Interface /admin (étape 6)
  admin: {
    identifiant: 'admin',
    // Coût de bcrypt : 12 = environ 0,4 s par essai. Les tests le baissent (BCRYPT_COST=4).
    bcryptCost: Number(process.env.BCRYPT_COST) || 12,
    inactiviteMs: 2 * 60 * 60 * 1000,   // déconnexion après 2 h sans action
    dureeMaxMs: 12 * 60 * 60 * 1000,    // et au plus 12 h après la connexion
    tentatives: { fenetreMs: 15 * 60 * 1000, parIp: 5, global: 50 },
    motDePasseMin: 12,
    photoMaxOctets: 3 * 1024 * 1024,
    // Dossier des photos envoyées (hors de public/ : jamais exécuté, servi sous /uploads)
    dossierPhotos: process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
  },
  // Doit rester identique au tableau des horaires de public/index.html
  horaires: {
    0: { ouvre: '11:00', ferme: '22:00' },
    1: { ouvre: '11:00', ferme: '23:00' },
    2: { ouvre: '11:00', ferme: '23:00' },
    3: { ouvre: '11:00', ferme: '23:00' },
    4: { ouvre: '11:00', ferme: '23:00' },
    5: { ouvre: '11:00', ferme: '02:00' },
    6: { ouvre: '11:00', ferme: '00:00' },
  },
};
