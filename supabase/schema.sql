-- Base MS Techniker sur Supabase (PostgreSQL).
-- À exécuter une seule fois : Supabase → SQL Editor → New query → coller → Run.

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  cree_le timestamptz not null default now(),
  nom text not null,
  email text not null,
  telephone text,
  sujet text,
  message text not null,
  statut text not null default 'nouveau' check (statut in ('nouveau','traite'))
);

create table if not exists public.commandes (
  id bigint generated always as identity primary key,
  reference text unique,
  cree_le timestamptz not null default now(),
  offre text not null check (offre in ('starter','business','pro','enterprise')),
  prix_usd integer not null,
  duree_mois integer not null default 1 check (duree_mois in (1,3,6,12)),
  nom text not null,
  entreprise text,
  email text not null,
  telephone text not null,
  usage text,
  statut text not null default 'nouvelle' check (statut in ('nouvelle','en_cours','active','annulee')),
  note_interne text
);

create table if not exists public.devis (
  id bigint generated always as identity primary key,
  reference text unique,
  cree_le timestamptz not null default now(),
  type_client text not null check (type_client in ('particulier','entreprise')),
  service text not null,
  description text not null,
  budget text,
  delai text,
  localisation text,
  nom text not null,
  email text not null,
  telephone text not null,
  entreprise text,
  secteur text,
  taille text,
  fonction text,
  statut text not null default 'nouveau' check (statut in ('nouveau','en_etude','envoye','accepte','refuse')),
  montant_usd integer check (montant_usd >= 0),
  note_interne text
);

-- Références lisibles : MST-2026-0001 (commandes), DEV-2026-0001 (devis)
create or replace function public.mst_reference() returns trigger
language plpgsql as $$
begin
  if new.reference is null then
    new.reference := tg_argv[0] || '-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(new.id::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists commandes_reference on public.commandes;
create trigger commandes_reference before insert on public.commandes
  for each row execute function public.mst_reference('MST');

drop trigger if exists devis_reference on public.devis;
create trigger devis_reference before insert on public.devis
  for each row execute function public.mst_reference('DEV');

-- Indicateurs du tableau de bord /admin
create or replace view public.stats with (security_invoker = true) as
select
  (select count(*) from public.commandes)::int as commandes,
  (select count(*) from public.commandes where statut = 'nouvelle')::int as commandes_nouvelles,
  (select count(*) from public.commandes where statut = 'active')::int as commandes_actives,
  (select coalesce(sum(prix_usd), 0) from public.commandes where statut = 'active')::int as revenu_mensuel_usd,
  (select count(*) from public.messages)::int as messages,
  (select count(*) from public.messages where statut = 'nouveau')::int as messages_nouveaux,
  (select count(*) from public.devis)::int as devis,
  (select count(*) from public.devis where statut = 'nouveau')::int as devis_nouveaux,
  (select coalesce(sum(montant_usd), 0) from public.devis where statut = 'accepte')::int as devis_acceptes_usd;

-- Sécurité : RLS activée sans aucune règle publique.
-- Seule la fonction Vercel (clé service_role, côté serveur) lit et écrit.
alter table public.messages  enable row level security;
alter table public.commandes enable row level security;
alter table public.devis     enable row level security;
revoke all on public.messages, public.commandes, public.devis, public.stats from anon, authenticated;
