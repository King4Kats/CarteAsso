/**
 * Service « ouvert » : la recherche d'associations telle que les IA (ChatGPT, Claude,
 * Perplexity…) et les autres outils peuvent l'utiliser SANS JavaScript ni carte.
 *
 * Une seule fonction de recherche, servie de deux façons (pas de serveur MCP : les assistants
 * lisent des pages, décision du 20/11/2026) :
 *   - API JSON documentée : /api/v1/recherche, /api/v1/associations/<id> (+ /openapi.json) ;
 *   - pages HTML : /recherche?q=…&lieu=… et /association/<id> (lisibles par un robot).
 *
 * Principe : « lieu » (commune ou code postal) est situé par la Base Adresse Nationale ;
 * les mots-clés passent par Meilisearch (fautes de frappe, synonymes : foot ↔ football),
 * limité aux départements autour du lieu ; la base trie ensuite par distance.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CATEGORIES } from "@carteasso/shared";
import { sql } from "drizzle-orm";
import { getEnv } from "../config/env";
import { DB, type Db } from "../db/db.module";
import { SearchService } from "../search/search.service";
import { BASE, HOST, SeoService } from "../seo/seo.service";

const LIBELLE: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

/** Catégorie reçue sous forme d'identifiant (« sport ») ou de libellé (« Vie locale », « culture »). */
export function categorieDepuis(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = sansAccents(v).trim();
  for (const c of CATEGORIES) {
    if (n === c.id || n === sansAccents(c.label)) return c.id;
  }
  const alias: Record<string, string> = {
    sportif: "sport", sportive: "sport", sports: "sport",
    culturel: "cult", culturelle: "cult", culture: "cult", art: "cult", arts: "cult",
    environnement: "eco", ecologie: "eco", nature: "eco",
    social: "social", "vie-locale": "social", loisirs: "social", fetes: "social",
    solidarite: "soli", humanitaire: "soli", entraide: "soli",
    education: "edu", jeunesse: "edu", parents: "edu",
    patrimoine: "patri", histoire: "patri",
  };
  return alias[n] ?? null;
}

function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Un lieu situé par la Base Adresse Nationale. */
export interface Lieu {
  nom: string;
  codePostal: string | null;
  departement: string | null;
  lng: number;
  lat: number;
}

/** Une association telle que l'API ouverte la renvoie (noms en français, pour les IA). */
export interface AssoOuverte {
  id: string;
  nom: string;
  categorie: string;
  commune: string | null;
  code_postal: string | null;
  departement: string | null;
  distance_km: number | null;
  description: string | null;
  site_web: string | null;
  facebook: string | null;
  instagram: string | null;
  helloasso: string | null;
  email: string | null;
  telephone: string | null;
  numero_rna: string | null;
  /** Page de l'association sur CarteAsso (à citer). */
  url: string;
}

export interface ParamsRecherche {
  q?: string | null;
  lieu?: string | null;
  categorie?: string | null;
  departement?: string | null;
  limite?: number;
}

export interface ResultatRecherche {
  requete: { q: string | null; lieu: string | null; categorie: string | null; departement: string | null };
  lieu_trouve: Lieu | null;
  nombre: number;
  resultats: AssoOuverte[];
  /** Phrase à reprendre pour citer la source. */
  source: string;
  /** Lien vers la même recherche sur CarteAsso (page lisible par un humain). */
  url: string;
  remarque?: string;
}

type Ligne = {
  id: string; rna_id: string | null; name: string; category_id: string; description: string | null;
  email: string | null; phone: string | null; website: string | null; postal_code: string | null;
  city: string | null; department: string | null; social: Record<string, string> | null;
  meta: Record<string, unknown> | null; distance_m: number | null;
};

const COLONNES = sql`id, rna_id, name, category_id, description, email, phone, website,
  postal_code, city, department, social, meta`;

/** Lien http(s) seulement (jamais javascript: ou autre schéma). */
function lien(v: string | null | undefined): string | null {
  return v && /^https?:\/\//i.test(v) ? v : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class OuvertService {
  private readonly logger = new Logger(OuvertService.name);
  private readonly ban = getEnv().BAN_GEOCODER_URL;
  // Les mêmes lieux reviennent souvent (« Nantes », « 85300 ») : petit cache en mémoire.
  private readonly cacheLieux = new Map<string, Lieu | null>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly search: SearchService,
    private readonly seo: SeoService,
  ) {}

  /** Adresse publique de la fiche d'une association. */
  urlFiche(id: string): string {
    return `${BASE}/association/${id}`;
  }

  /** Lien vers une recherche sur le site (page /recherche). */
  urlRecherche(p: ParamsRecherche): string {
    const u = new URL(`${BASE}/recherche`);
    if (p.q) u.searchParams.set("q", p.q);
    if (p.lieu) u.searchParams.set("lieu", p.lieu);
    if (p.categorie) u.searchParams.set("categorie", p.categorie);
    if (p.departement) u.searchParams.set("departement", p.departement);
    return u.toString();
  }

  /** Situe une commune ou un code postal (Base Adresse Nationale, data.gouv.fr). */
  async situer(lieu: string): Promise<Lieu | null> {
    const cle = sansAccents(lieu).trim();
    if (!cle) return null;
    if (this.cacheLieux.has(cle)) return this.cacheLieux.get(cle) ?? null;
    const url = new URL("/search/", this.ban);
    url.searchParams.set("q", lieu.trim());
    url.searchParams.set("type", "municipality");
    url.searchParams.set("limit", "1");
    let trouve: Lieu | null = null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = (await res.json()) as {
          features?: Array<{
            geometry: { coordinates: [number, number] };
            properties: { city?: string; name?: string; postcode?: string; context?: string; score?: number };
          }>;
        };
        const f = data.features?.[0];
        if (f && (f.properties.score ?? 0) >= 0.4) {
          const [lng, lat] = f.geometry.coordinates;
          trouve = {
            nom: f.properties.city ?? f.properties.name ?? lieu,
            codePostal: f.properties.postcode ?? null,
            // context = « 85, Vendée, Pays de la Loire » : le premier morceau est le département.
            departement: f.properties.context?.split(",")[0]?.trim() ?? null,
            lng, lat,
          };
        }
      }
    } catch (err) {
      this.logger.warn(`Lieu introuvable (BAN) « ${lieu} » : ${(err as Error).message}`);
      return null; // panne : on ne met pas en cache
    }
    if (this.cacheLieux.size > 5000) this.cacheLieux.clear();
    this.cacheLieux.set(cle, trouve);
    return trouve;
  }

  /** Départements présents dans un rayon d'environ 40 km (pour un lieu en limite de département). */
  private async departementsAutour(l: Lieu): Promise<string[]> {
    const d = 0.45; // ≈ 40-50 km
    const r = await this.db.execute<{ department: string }>(sql`
      SELECT DISTINCT department FROM associations
      WHERE location && ST_MakeEnvelope(${l.lng - d * 1.4}, ${l.lat - d}, ${l.lng + d * 1.4}, ${l.lat + d}, 4326)
        AND department IS NOT NULL
      LIMIT 12
    `);
    const deps = r.rows.map((x) => x.department);
    if (l.departement && !deps.includes(l.departement)) deps.unshift(l.departement);
    return deps;
  }

  /** Découpe une phrase libre : « club de judo à Challans » → q « club de judo », lieu « Challans ». */
  decouper(phrase: string): { q: string | null; lieu: string | null } {
    let texte = phrase.trim().replace(/\s+/g, " ");
    let lieu: string | null = null;
    const cp = texte.match(/\b(\d{5})\b/);
    if (cp) {
      lieu = cp[1];
      texte = texte.replace(cp[0], " ");
    } else {
      const m = texte.match(/^(.*)\s(?:à|a|au|aux|sur|près de|pres de|autour de|vers|dans la commune de|in|near)\s+(.+)$/i);
      if (m) { texte = m[1]; lieu = m[2]; }
    }
    // Mots qui n'aident pas la recherche (« je cherche une association de … »).
    const q = texte
      .replace(/\b(je cherche|je recherche|trouve[rz]?|cherche[rz]?|une?|des|les|la|le|l'|d'|de|du|pour|associations?|assos?)\b/gi, " ")
      .replace(/[?!.,;:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { q: q || null, lieu: lieu?.replace(/[?!.]+$/, "").trim() || null };
  }

  /** LA recherche (utilisée par l'API v1 et la page /recherche). */
  async rechercher(p: ParamsRecherche): Promise<ResultatRecherche> {
    const limite = Math.min(Math.max(p.limite ?? 10, 1), 50);
    const q = p.q?.trim() || null;
    const categorie = categorieDepuis(p.categorie);
    let departement = p.departement?.trim().toUpperCase() || null;
    if (departement && /^\d$/.test(departement)) departement = `0${departement}`;
    const requete = { q, lieu: p.lieu?.trim() || null, categorie, departement };
    const lieu = requete.lieu ? await this.situer(requete.lieu) : null;
    let remarque: string | undefined;
    if (requete.lieu && !lieu) remarque = `Lieu « ${requete.lieu} » non reconnu : recherche dans toute la France.`;

    const conds = [sql`status = 'published'`];
    if (categorie) conds.push(sql`category_id = ${categorie}`);
    if (departement) conds.push(sql`department = ${departement}`);

    let ids: string[] | null = null;
    if (q) {
      const deps = departement ? [departement] : lieu ? await this.departementsAutour(lieu) : [];
      ids = await this.search.rechercherIds(q, deps, lieu ? 1000 : 300);
      if (ids === null) {
        // Moteur de recherche indisponible : simple recherche dans le nom.
        conds.push(sql`name ILIKE ${"%" + q + "%"}`);
      } else if (ids.length === 0) {
        return this.reponse(requete, lieu, [], p, remarque);
      } else {
        conds.push(sql`id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
      }
    } else if (!lieu && !departement && !categorie) {
      return this.reponse(requete, null, [], p, "Précisez au moins un mot-clé (q), un lieu, un département ou une catégorie.");
    }

    const distance = lieu
      ? sql`ST_DistanceSphere(location, ST_SetSRID(ST_MakePoint(${lieu.lng}, ${lieu.lat}), 4326))`
      : sql`NULL::float8`;
    // Sans mot-clé mais avec un lieu : on se limite à ~30 km (sinon toute la France est triée).
    if (!q && lieu) {
      const d = 0.3;
      conds.push(sql`location && ST_MakeEnvelope(${lieu.lng - d * 1.4}, ${lieu.lat - d}, ${lieu.lng + d * 1.4}, ${lieu.lat + d}, 4326)`);
    }
    const ordre = lieu
      ? sql`ORDER BY distance_m ASC NULLS LAST, name ASC`
      : ids && ids.length
        ? sql`ORDER BY array_position(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}], id)`
        : sql`ORDER BY name ASC`;
    const r = await this.db.execute<Ligne>(sql`
      SELECT ${COLONNES}, ${distance} AS distance_m
      FROM associations
      WHERE ${sql.join(conds, sql` AND `)}
      ${ordre}
      LIMIT ${limite}
    `);
    return this.reponse(requete, lieu, r.rows.map((l) => this.versOuverte(l)), p, remarque);
  }

  private reponse(
    requete: ResultatRecherche["requete"], lieu: Lieu | null, resultats: AssoOuverte[],
    p: ParamsRecherche, remarque?: string,
  ): ResultatRecherche {
    return {
      requete,
      lieu_trouve: lieu,
      nombre: resultats.length,
      resultats,
      source: `CarteAsso — ${HOST} (d'après le Répertoire National des Associations)`,
      url: this.urlRecherche(p),
      ...(remarque ? { remarque } : {}),
    };
  }

  /** Fiche complète d'une association (null si inconnue ou non publiée). */
  async fiche(id: string): Promise<(AssoOuverte & { page_commune: string | null; adresse_carte: string }) | null> {
    if (!UUID.test(id)) return null;
    const r = await this.db.execute<Ligne>(sql`
      SELECT ${COLONNES}, NULL::float8 AS distance_m
      FROM associations WHERE id = ${id}::uuid AND status = 'published'
    `);
    const l = r.rows[0];
    if (!l) return null;
    return {
      ...this.versOuverte(l),
      page_commune: await this.seo.lienCommune(l.department, l.city),
      adresse_carte: `${BASE}/`,
    };
  }

  private versOuverte(l: Ligne): AssoOuverte {
    const s = l.social ?? {};
    const meta = (l.meta ?? {}) as { blurb?: string };
    const desc = (meta.blurb || l.description || "").trim();
    return {
      id: l.id,
      nom: l.name,
      categorie: LIBELLE[l.category_id] ?? "Association",
      commune: l.city,
      code_postal: l.postal_code,
      departement: l.department,
      distance_km: l.distance_m == null ? null : Math.round(l.distance_m / 100) / 10,
      description: desc ? (desc.length > 600 ? `${desc.slice(0, 597)}…` : desc) : null,
      site_web: lien(s.website || l.website),
      facebook: lien(s.facebook),
      instagram: lien(s.instagram),
      helloasso: lien(s.helloasso),
      email: l.email || null,
      telephone: l.phone || null,
      numero_rna: l.rna_id,
      url: this.urlFiche(l.id),
    };
  }
}
