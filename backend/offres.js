'use strict';
// Catalogue des offres serveurs (source unique côté backend).
// Les prix en FC sont indicatifs, comme sur les affiches MS Techniker.

const OFFRES = [
  {
    id: 'starter', nom: 'Starter', prixUsd: 15, prixFc: 34000,
    pour: 'Sites web et petites applications',
    caracteristiques: ['2 vCPU', '4 Go RAM', '50 Go SSD', 'Bande passante : 1 To/mois', 'Certificat SSL', 'Sauvegardes', 'Monitoring'],
  },
  {
    id: 'business', nom: 'Business', prixUsd: 30, prixFc: 68000,
    pour: 'PME et applications professionnelles',
    caracteristiques: ['4 vCPU', '8 Go RAM', '100 Go NVMe', 'Bande passante : 2 To/mois', 'Sauvegardes automatisées', 'Sécurité renforcée', 'Monitoring 24/7', 'Support prioritaire'],
  },
  {
    id: 'pro', nom: 'Pro', prixUsd: 60, prixFc: 136000,
    pour: 'Applications critiques et haute performance',
    caracteristiques: ['8 vCPU', '16 Go RAM', '250 Go NVMe', 'Bande passante : 5 To/mois', 'Sauvegardes avancées', 'Sécurité renforcée', 'Monitoring 24/7', 'Administration serveur', 'Support prioritaire'],
  },
  {
    id: 'enterprise', nom: 'Enterprise', prixUsd: 120, prixFc: 272000,
    pour: 'Infrastructure conçue selon vos besoins',
    caracteristiques: ['16 vCPU', '32 Go RAM', '500 Go NVMe', 'Bande passante : 10 To/mois', 'Infrastructure dédiée', 'Haute disponibilité', 'Sauvegardes avancées', 'Monitoring 24/7', 'Administration', 'Support dédié'],
  },
];

const parId = (id) => OFFRES.find((o) => o.id === String(id || '').toLowerCase()) || null;

module.exports = { OFFRES, parId };
