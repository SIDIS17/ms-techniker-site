'use strict';
// Stockage Supabase (PostgreSQL) via son API REST, avec fetch : aucune dépendance.
// Utilisé par la fonction Vercel. Clé « service_role » uniquement côté serveur.

function creerStoreSupabase({ url, cle, fetchImpl = fetch }) {
  if (!url || !cle) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
  const base = url.replace(/\/$/, '') + '/rest/v1';
  const entetes = { apikey: cle, Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' };

  async function req(methode, chemin, corps, prefer) {
    const r = await fetchImpl(base + chemin, {
      method: methode,
      headers: prefer ? { ...entetes, Prefer: prefer } : entetes,
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    const texte = await r.text();
    if (!r.ok) throw new Error(`Supabase ${methode} ${chemin} : ${r.status} ${texte.slice(0, 200)}`);
    return texte ? JSON.parse(texte) : null;
  }
  const inserer = async (table, ligne) => (await req('POST', `/${table}`, ligne, 'return=representation'))[0];
  const lister = (table, limite = 500) => req('GET', `/${table}?select=*&order=id.desc&limit=${limite}`);
  const sansVide = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const maj = async (table, id, champs) => {
    const c = sansVide(champs);
    if (!Object.keys(c).length) return (await req('GET', `/${table}?select=*&id=eq.${Number(id)}`))[0] || null;
    return (await req('PATCH', `/${table}?id=eq.${Number(id)}`, c, 'return=representation'))[0] || null;
  };
  const nul = (v) => (v ? v : null);

  return {
    type: 'supabase',
    async ajouterMessage(m) {
      const l = await inserer('messages', { nom: m.nom, email: m.email, telephone: nul(m.telephone), sujet: nul(m.sujet), message: m.message });
      return l.id;
    },
    async ajouterCommande(c) {
      const l = await inserer('commandes', { offre: c.offre, prix_usd: c.prixUsd, duree_mois: c.dureeMois, nom: c.nom, entreprise: nul(c.entreprise), email: c.email, telephone: c.telephone, usage: nul(c.usage) });
      return { id: l.id, reference: l.reference };
    },
    async ajouterDevis(d) {
      const l = await inserer('devis', {
        type_client: d.typeClient, service: d.service, description: d.description, budget: nul(d.budget), delai: nul(d.delai),
        localisation: nul(d.localisation), nom: d.nom, email: d.email, telephone: d.telephone,
        entreprise: nul(d.entreprise), secteur: nul(d.secteur), taille: nul(d.taille), fonction: nul(d.fonction),
      });
      return { id: l.id, reference: l.reference };
    },
    listerCommandes: () => lister('commandes'),
    listerMessages: () => lister('messages'),
    listerDevis: () => lister('devis'),
    majCommande: (id, { statut, note }) => maj('commandes', id, { statut, note_interne: note }),
    async majMessage(id, statut) { return Boolean(await maj('messages', id, { statut })); },
    majDevis: (id, { statut, montant, note }) => maj('devis', id, { statut, montant_usd: montant, note_interne: note }),
    async stats() { return (await req('GET', '/stats?select=*'))[0]; },
  };
}

module.exports = { creerStoreSupabase };
