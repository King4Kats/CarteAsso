/**
 * Service SEO : génère de VRAIES pages HTML (côté serveur) par commune, ex.
 *   /vendee/challans, /haute-garonne/toulouse, /lot/cahors …
 * avec la liste des associations en clair -> indexable par Google (la SPA, en JS,
 * ne se référence pas bien sur "association Challans").
 *
 * Couvre TOUTE la France (métropole + DROM) — voir territoires.ts.
 * Ces pages ne sont PAS mises en avant dans le site (on n'y arrive que via Google) ;
 * elles renvoient vers la carte interactive. Le sitemap.xml les liste toutes.
 */
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { CATEGORIES } from "@carteasso/shared";
import { DB, type Db } from "../db/db.module";
import { SEO_DEPARTEMENTS, SEO_DEPT_CODES, SEO_CODE_BY_SLUG } from "./territoires";
import { getEnv } from "../config/env";
import { renderOg } from "./og-image";

// Domaine public, réglable par SITE_URL (voir config/env.ts) : rien d'autre à changer
// pour changer de domaine (bascule gemenskarte.fr -> carteasso.fr faite le 20/11/2026).
export const BASE = getEnv().SITE_URL.replace(/\/+$/, "");
export const HOST = new URL(BASE).host;
const MAX_LISTE = 600; // plafond d'assos affichées par page (évite des pages énormes)

const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

// Tournure naturelle pour les sous-titres H2 « Associations <…> à <ville> »
// (capte la longue traîne : "association sportive Brest", "association culturelle …").
const CAT_GENRE: Record<string, string> = {
  sport: "sportives",
  cult: "culturelles",
  eco: "écologie et environnement",
  social: "de vie locale",
  soli: "de solidarité",
  edu: "éducation et jeunesse",
  patri: "de patrimoine",
};
// Ordre d'affichage stable des catégories (celui de CATEGORIES).
const CAT_ORDER: string[] = CATEGORIES.map((c) => c.id);

// Slugs d'URL des pages catégorie×département : /<dept>/associations-sportives, etc.
// Volontairement explicites (riches en mots-clés + AUCUNE collision possible avec un
// slug de commune) -> le routeur teste d'abord ces slugs, sinon c'est une commune.
const CAT_SLUG: Record<string, string> = {
  sport: "associations-sportives",
  cult: "associations-culturelles",
  eco: "associations-environnement",
  social: "associations-vie-locale",
  soli: "associations-solidarite",
  edu: "associations-education",
  patri: "associations-patrimoine",
};
const CAT_BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(CAT_SLUG).map(([id, slug]) => [slug, id]),
);

export function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cleanCity(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
function slugify(s: string): string {
  return cleanCity(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function isoDate(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v ?? ""));
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

interface Commune { dept: string; deptSlug: string; city: string; display: string; slug: string; n: number; updated: string; }

@Injectable()
export class SeoService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // La liste des communes (tous départements couverts) change peu : cache 30 min.
  private cache: { at: number; list: Commune[] } | null = null;

  private async allCommunes(): Promise<Commune[]> {
    if (this.cache && Date.now() - this.cache.at < 30 * 60 * 1000) return this.cache.list;
    const inList = SEO_DEPT_CODES.map((c) => `'${c}'`).join(","); // codes constants -> sûr
    const rows = await this.db.execute<{ department: string; city: string; n: number; updated: unknown }>(
      sql.raw(`
        SELECT department, city, count(*)::int AS n, max(updated_at) AS updated
        FROM associations
        WHERE department IN (${inList}) AND status = 'published'
          AND city IS NOT NULL AND length(trim(city)) > 0
        GROUP BY department, city
        ORDER BY count(*) DESC, city ASC
      `),
    );
    const seenByDept: Record<string, Set<string>> = {};
    const list: Commune[] = [];
    for (const r of rows.rows) {
      const meta = SEO_DEPARTEMENTS[r.department];
      if (!meta) continue;
      const display = cleanCity(r.city);
      let slug = slugify(display);
      if (!slug) continue;
      const seen = (seenByDept[r.department] ??= new Set());
      if (seen.has(slug)) slug = `${slug}-${list.length}`;
      seen.add(slug);
      list.push({ dept: r.department, deptSlug: meta.slug, city: r.city, display, slug, n: r.n, updated: isoDate(r.updated) });
    }
    this.cache = { at: Date.now(), list };
    return list;
  }

  /** Adresse de la page commune d'une association (null si sa commune n'a pas de page). */
  async lienCommune(dept: string | null, city: string | null): Promise<string | null> {
    if (!dept || !city) return null;
    const c = (await this.allCommunes()).find((x) => x.dept === dept && x.city === city);
    return c ? `${BASE}/${c.deptSlug}/${c.slug}` : null;
  }

  /** Identité de l'éditeur (schema.org) : répétée sur chaque page pour que Google
   *  et les moteurs IA rattachent toutes les pages à la même entité « CarteAsso »
   *  (Knowledge Graph, citations « selon CarteAsso… »). */
  private publisherLd(): object[] {
    return [
      {
        "@context": "https://schema.org", "@type": "Organization", "@id": `${BASE}/#org`,
        name: "CarteAsso", url: `${BASE}/`,
        logo: { "@type": "ImageObject", url: `${BASE}/icon-512.png`, width: 512, height: 512 },
        description: "Carte interactive et gratuite de toutes les associations de France, à partir du Répertoire National des Associations (RNA).",
        sameAs: ["https://github.com/King4Kats/CarteAsso"],
      },
      {
        "@context": "https://schema.org", "@type": "WebSite", "@id": `${BASE}/#site`,
        name: "CarteAsso", alternateName: ["Carte Asso", "La carte des associations"],
        url: `${BASE}/`, inLanguage: "fr-FR", publisher: { "@id": `${BASE}/#org` },
      },
    ];
  }

  /** Barre de partage SANS JavaScript (la CSP interdit le JS inline) : de simples liens. */
  private shareBar(url: string, text: string): string {
    const u = encodeURIComponent(url);
    const t = encodeURIComponent(text);
    const links: [string, string][] = [
      ["WhatsApp", `https://wa.me/?text=${t}%20${u}`],
      ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
      ["X", `https://twitter.com/intent/tweet?url=${u}&text=${t}`],
      ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
      ["E-mail", `mailto:?subject=${t}&body=${u}`],
    ];
    return `<div class="share"><span>Partager :</span>${links
      .map(([n, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener nofollow">${n}</a>`)
      .join("")}</div>`;
  }

  /** Enveloppe un contenu dans un document HTML complet (head SEO + style minimal). */
  /** Gabarit HTML commun des pages SEO (public : aussi utilisé par les pages /recherche et
   *  /association/<id> du module « ouvert »). `robots` : par défaut indexable. */
  doc(o: { title: string; desc: string; canonical: string; jsonld?: string; body: string; share?: string; og?: string; robots?: string }): string {
    const og = o.og ?? `${BASE}/og-image.png`;
    // Le JSON-LD de la page + l'identité éditeur, en un seul bloc.
    const own = o.jsonld ? JSON.parse(o.jsonld) : [];
    const ld = JSON.stringify([...(Array.isArray(own) ? own : [own]), ...this.publisherLd()]).replace(/</g, "\\u003c");
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<link rel="canonical" href="${o.canonical}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#e11567">
<meta name="robots" content="${o.robots ?? "index, follow, max-image-preview:large, max-snippet:-1"}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CarteAsso">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${o.canonical}">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.desc)}">
<meta name="twitter:image" content="${og}">
<script type="application/ld+json">${ld}</script>
<style>
:root{--ink:#15151b;--muted:#6b7280;--accent:#ff2d78;--bg:#fff;--soft:#fbfbf9;--line:#ececec}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);line-height:1.6}
.wrap{max-width:880px;margin:0 auto;padding:20px 20px 64px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);margin-bottom:28px}
.logo{font-weight:800;font-size:20px;letter-spacing:-.02em;color:var(--ink);text-decoration:none}.logo span{color:var(--accent)}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:999px;white-space:nowrap}
h1{font-size:clamp(26px,5vw,38px);font-weight:800;letter-spacing:-.03em;line-height:1.1;margin:0 0 12px}
h2{font-size:20px;font-weight:800;letter-spacing:-.02em;margin:32px 0 12px}
h3{font-size:16px;font-weight:700;margin:20px 0 6px;color:var(--ink)}
.lead{font-size:17px;color:var(--muted);margin:0 0 28px}
.lead strong{color:var(--ink);font-weight:700}
ul.assos{list-style:none;padding:0;margin:0;display:grid;gap:8px}
ul.assos li{padding:11px 15px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}
.nom{font-weight:700}.cat{color:var(--muted);font-size:13px}
ul.assos a{color:var(--accent);text-decoration:none;font-size:13px;font-weight:600;margin-left:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.grid a{padding:9px 13px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink);font-weight:600;font-size:14px;background:var(--soft)}
.grid a:hover{border-color:var(--accent)}.grid .c{color:var(--muted);font-weight:500}
.deps{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.deps a{font-size:13px;color:var(--muted);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:5px 12px}
footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
footer a{color:var(--muted)}
.logo img{display:block;height:34px;width:auto}
.share{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 24px;font-size:13px;color:var(--muted)}
.share a{border:1px solid var(--line);border-radius:999px;padding:5px 12px;color:var(--ink);text-decoration:none;font-weight:600}
.share a:hover{border-color:var(--accent)}
.box{border:1px solid var(--line);border-radius:16px;padding:18px 20px;background:var(--soft);margin-top:32px}
.box h2{margin-top:0}
textarea.code{width:100%;font:13px/1.5 ui-monospace,Consolas,monospace;border:1px solid var(--line);border-radius:10px;padding:10px;resize:vertical;background:#fff}
table.stats{width:100%;border-collapse:collapse;font-size:15px}
table.stats th,table.stats td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
table.stats td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 24px}
.kpis div{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:var(--soft)}
.kpis b{display:block;font-size:26px;letter-spacing:-.02em}.kpis span{color:var(--muted);font-size:13px}
</style>
</head>
<body><div class="wrap">
<header>
  <a class="logo" href="/" aria-label="CarteAsso — accueil"><img src="/logo.svg" alt="CarteAsso" width="121" height="34"></a>
  <a class="cta" href="/">Voir la carte interactive →</a>
</header>
${o.share ?? ""}
${o.body}
<footer>Données issues du Répertoire National des Associations (RNA, data.gouv.fr) et enrichissements CarteAsso, sous <a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence/" rel="license">Licence Ouverte 2.0</a> (réutilisation libre avec mention « CarteAsso — ${HOST} »). · <a href="/">Accueil</a> · <a href="/territoires">Toutes les communes</a> · <a href="/chiffres">Les associations en chiffres</a> · <a href="/badge">Badge et carte à intégrer</a></footer>
</div></body></html>`;
  }

  /** Fil d'Ariane schema.org (BreadcrumbList) : aide Google à afficher le chemin. */
  private breadcrumb(items: [string, string][]): object {
    return {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: items.map(([name, url], i) => ({
        "@type": "ListItem", position: i + 1, name, item: url,
      })),
    };
  }

  /** Petite barre de liens vers les autres départements couverts (cross-linking crawl). */
  private autresDepts(currentSlug?: string): string {
    const links = Object.values(SEO_DEPARTEMENTS)
      .filter((d) => d.slug !== currentSlug)
      .map((d) => `<a href="/${d.slug}">${esc(d.nom)}</a>`)
      .join("");
    return `<div class="deps">${links}</div>`;
  }

  /** Page d'une commune : /<deptSlug>/<communeSlug>. null si introuvable. */
  async communePage(deptSlug: string, communeSlug: string): Promise<string | null> {
    const deptCode = SEO_CODE_BY_SLUG[deptSlug];
    if (!deptCode) return null;
    const c = (await this.allCommunes()).find((x) => x.dept === deptCode && x.slug === communeSlug);
    if (!c) return null;
    const { nom: deptNom, region } = SEO_DEPARTEMENTS[deptCode];
    const rows = await this.db.execute<{ id: string; name: string; category_id: string; social: Record<string, string> | null; website: string | null }>(sql`
      SELECT id, name, category_id, social, website
      FROM associations
      WHERE department = ${c.dept} AND status = 'published' AND city = ${c.city}
      ORDER BY name ASC
      LIMIT ${MAX_LISTE}
    `);
    const items = rows.rows;

    // Une ligne <li> d'association (nom + catégorie + éventuel lien site officiel).
    // Le lien n'est rendu que s'il commence par http(s) : esc() neutralise les
    // guillemets mais pas un schéma dangereux du type javascript: (défense en
    // profondeur — la validation d'URL en amont accepte n'importe quel schéma).
    const renderLi = (a: typeof items[number]): string => {
      const label = CAT_LABEL[a.category_id] ?? "Association";
      const site = a.social?.website || a.website || null;
      const safeSite = site && /^https?:\/\//i.test(site) ? site : null;
      const link = safeSite ? ` <a href="${esc(safeSite)}" target="_blank" rel="nofollow noopener">site</a>` : "";
      // Le nom mène à la fiche de l'association (/association/<id>) : page à citer.
      return `  <li><a class="nom" href="/association/${a.id}" style="color:inherit;font-size:inherit;margin:0">${esc(a.name)}</a> <span class="cat">· ${esc(label)}</span>${link}</li>`;
    };

    // On REGROUPE par catégorie : chaque groupe devient une section avec un H2
    // riche en mots-clés ("Associations sportives à <ville>"). Bien meilleur pour
    // le référencement que la liste à plat (structure + longue traîne).
    const byCat: Record<string, typeof items> = {};
    for (const a of items) (byCat[a.category_id] ??= []).push(a);
    const catsPresent = CAT_ORDER.filter((id) => byCat[id]?.length);
    const sections = catsPresent.map((id) => {
      const genre = CAT_GENRE[id] ?? (CAT_LABEL[id] ?? "").toLowerCase();
      const lis = byCat[id].map(renderLi).join("\n");
      return `<h2>Associations ${esc(genre)} à ${esc(c.display)}</h2>\n<ul class="assos">\n${lis}\n</ul>`;
    }).join("\n");
    const reste = c.n > items.length ? `<p class="lead">… et ${c.n - items.length} autres associations à ${esc(c.display)}, à découvrir sur la <a href="/">carte interactive</a>.</p>` : "";

    // Maillage interne : quelques autres communes du même département.
    const voisines = (await this.allCommunes())
      .filter((x) => x.dept === deptCode && x.slug !== c.slug)
      .slice(0, 24)
      .map((x) => `<a href="/${x.deptSlug}/${x.slug}">Associations ${esc(x.display)}</a>`)
      .join("");

    // Phrase d'intro unique : ville + département + région + nombre + catégories.
    const themes = catsPresent.map((id) => (CAT_LABEL[id] ?? "").toLowerCase()).filter(Boolean);
    const themesTxt = themes.length ? themes.join(", ") : "sport, culture, solidarité, environnement, éducation";

    // FAQ : réponses courtes et autonomes (titres en questions). Restituées en
    // HTML visible ET en schema FAQPage -> citables par les moteurs IA (AI Overviews,
    // ChatGPT, Perplexity) qui répondent aux requêtes "associations à <ville>".
    const faq: [string, string][] = [
      [
        `Combien d'associations y a-t-il à ${c.display} ?`,
        `${c.display} (${deptNom}) compte ${c.n} association${c.n > 1 ? "s" : ""} référencée${c.n > 1 ? "s" : ""} sur CarteAsso, issues du Répertoire National des Associations (RNA).`,
      ],
      [
        `Comment trouver une association à ${c.display} ?`,
        `Parcourez la liste par thème ci-dessus (${themesTxt}), ou ouvrez la carte interactive de CarteAsso pour localiser les associations de ${c.display} et accéder à leurs coordonnées et à leur site.`,
      ],
      [
        `Quels types d'associations trouve-t-on à ${c.display} ?`,
        themes.length
          ? `À ${c.display}, on trouve notamment des associations ${themes.join(", ")}.`
          : `On trouve à ${c.display} des associations dans des domaines variés : sport, culture, solidarité, environnement, éducation.`,
      ],
    ];
    const faqHtml = `<h2>Questions fréquentes sur les associations à ${esc(c.display)}</h2>\n` +
      faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p class="lead">${esc(a)}</p>`).join("\n");

    const title = `Associations à ${c.display} (${deptNom}) — annuaire des assos`;
    const desc = `Les ${c.n} associations de ${c.display} (${deptNom}) : ${themesTxt}. Trouvez une association à ${c.display}, ses coordonnées et son site sur CarteAsso.`;
    const jsonld = JSON.stringify([
      {
        "@context": "https://schema.org", "@type": "ItemList",
        name: `Associations à ${c.display} (${deptNom})`, numberOfItems: c.n,
        itemListElement: items.slice(0, 100).map((a, i) => ({ "@type": "ListItem", position: i + 1, name: a.name })),
      },
      this.breadcrumb([
        ["Accueil", `${BASE}/`],
        [deptNom, `${BASE}/${c.deptSlug}`],
        [c.display, `${BASE}/${c.deptSlug}/${c.slug}`],
      ]),
      {
        "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: faq.map(([q, a]) => ({
          "@type": "Question", name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ]);
    const body = `
<h1>Associations à ${esc(c.display)} (${esc(deptNom)})</h1>
<p class="lead">Vous cherchez une <strong>association à ${esc(c.display)}</strong> ? CarteAsso référence ${c.n} association${c.n > 1 ? "s" : ""} à ${esc(c.display)}, dans le département ${esc(deptNom)} (${esc(region)}) — ${esc(themesTxt)}. Retrouvez-les ci-dessous, ou explorez-les sur la <a href="/">carte interactive</a>. Voir aussi <a href="/${c.deptSlug}">toutes les communes — ${esc(deptNom)}</a>.</p>
${sections}
${reste}
${faqHtml}
${this.integrerBox(c.deptSlug, c.slug, c.display)}
${voisines ? `<p class="lead" style="margin-top:32px">Associations dans d'autres communes du ${esc(deptNom)} :</p>\n<div class="deps">${voisines}</div>` : ""}`;
    const url = `${BASE}/${c.deptSlug}/${c.slug}`;
    const share = this.shareBar(url, `Les ${c.n} associations de ${c.display}, sur une carte :`);
    return this.doc({ title, desc, canonical: url, jsonld, body, share, og: `${BASE}/og/${c.deptSlug}/${c.slug}.png` });
  }

  /** Encart viral d'une page commune : la mairie intègre la liste sur son site
   *  (iframe -> lien retour), l'asso pose le badge. Sans JS : le code est dans un
   *  textarea en lecture seule, à sélectionner. */
  private integrerBox(deptSlug: string, slug: string, display: string): string {
    const iframe = `<iframe src="${BASE}/embed/${deptSlug}/${slug}" title="Associations de ${esc(display)} — CarteAsso" width="100%" height="520" style="border:0;border-radius:12px" loading="lazy"></iframe>`;
    return `<div class="box">
<h2>Mairie, office de tourisme : affichez les associations de ${esc(display)}</h2>
<p class="lead" style="margin-bottom:12px">Copiez ce code dans une page de votre site. La liste se met à jour toute seule, gratuitement.</p>
<textarea class="code" rows="3" readonly aria-label="Code à intégrer">${esc(iframe)}</textarea>
<p class="lead" style="margin:16px 0 0">Vous êtes une association de ${esc(display)} ? <a href="/badge">Ajoutez le badge « Référencée sur CarteAsso »</a> à votre site.</p>
</div>`;
  }

  /** Version INTÉGRABLE (iframe) de la liste d'une commune : compacte, sans en-tête,
   *  avec un lien « via CarteAsso » (lien retour = autorité + découverte). */
  async embedCommune(deptSlug: string, communeSlug: string): Promise<string | null> {
    const deptCode = SEO_CODE_BY_SLUG[deptSlug];
    if (!deptCode) return null;
    const c = (await this.allCommunes()).find((x) => x.dept === deptCode && x.slug === communeSlug);
    if (!c) return null;
    const rows = await this.db.execute<{ name: string; category_id: string; social: Record<string, string> | null; website: string | null }>(sql`
      SELECT name, category_id, social, website FROM associations
      WHERE department = ${c.dept} AND status = 'published' AND city = ${c.city}
      ORDER BY name ASC LIMIT ${MAX_LISTE}
    `);
    const byCat: Record<string, typeof rows.rows> = {};
    for (const a of rows.rows) (byCat[a.category_id] ??= []).push(a);
    const sections = CAT_ORDER.filter((id) => byCat[id]?.length).map((id) => {
      const lis = byCat[id].map((a) => {
        const site = a.social?.website || a.website || null;
        const safe = site && /^https?:\/\//i.test(site) ? site : null;
        return `<li>${safe ? `<a href="${esc(safe)}" target="_blank" rel="nofollow noopener">${esc(a.name)}</a>` : esc(a.name)}</li>`;
      }).join("");
      return `<h2>${esc(CAT_LABEL[id] ?? "Associations")} <small>${byCat[id].length}</small></h2><ul>${lis}</ul>`;
    }).join("");
    const page = `${BASE}/${c.deptSlug}/${c.slug}`;
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Associations de ${esc(c.display)} — CarteAsso</title>
<meta name="robots" content="noindex, follow"><link rel="canonical" href="${page}">
<style>
body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#15151b;background:#fff}
.w{padding:14px 16px}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 10px;color:#6b7280;font-size:13px}
h2{font-size:14px;margin:16px 0 6px;color:#e11567}h2 small{color:#6b7280;font-weight:500}
ul{margin:0;padding:0 0 0 18px}li{margin:2px 0}a{color:#15151b}
.via{position:sticky;bottom:0;background:#fff;border-top:1px solid #ececec;padding:8px 16px;font-size:12px;display:flex;align-items:center;gap:8px}
.via img{height:18px;width:auto}.via a{color:#e11567;font-weight:700;text-decoration:none}
</style></head><body>
<div class="w"><h1>${c.n} association${c.n > 1 ? "s" : ""} à ${esc(c.display)}</h1><p>Source : Répertoire National des Associations, enrichi par CarteAsso.</p>${sections}</div>
<div class="via"><img src="/favicon.svg" alt="" width="18" height="18"><a href="${page}" target="_blank" rel="noopener">Voir la carte des associations de ${esc(c.display)} sur CarteAsso</a></div>
</body></html>`;
  }

  /** Page /badge : le badge à poser sur le site d'une asso + le module à intégrer. */
  badgePage(): string {
    const badge = `<a href="${BASE}/" title="Retrouvez-nous sur CarteAsso, la carte des associations"><img src="${BASE}/badge.svg" alt="Association référencée sur CarteAsso" width="196" height="76"></a>`;
    const body = `
<h1>Badge « Référencée sur CarteAsso »</h1>
<p class="lead">Votre association est sur CarteAsso ? Montrez-le sur votre site, votre blog ou votre page HelloAsso. Le badge aide les habitants à vous trouver, et aide CarteAsso à faire connaître <strong>toutes</strong> les associations de France.</p>
<p><img src="/badge.svg" alt="Association référencée sur CarteAsso" width="196" height="76"></p>
<h2>Code à copier</h2>
<textarea class="code" rows="3" readonly aria-label="Code du badge">${esc(badge)}</textarea>
<p class="lead" style="margin-top:12px">Préférez une image ? <a href="/badge.png">Télécharger le badge en PNG</a>.</p>
<div class="box">
<h2>Pour les mairies et les offices de tourisme</h2>
<p class="lead" style="margin:0">Chaque page commune propose un code à intégrer : la liste des associations de votre commune, toujours à jour, sur votre propre site. <a href="/territoires">Trouver ma commune</a>.</p>
</div>
<div class="box">
<h2>Une erreur sur votre fiche ?</h2>
<p class="lead" style="margin:0">Ouvrez la <a href="/">carte</a>, retrouvez votre association et utilisez le formulaire de contact pour la corriger, la compléter ou la retirer.</p>
</div>`;
    return this.doc({
      title: "Badge « Référencée sur CarteAsso » pour votre association",
      desc: "Ajoutez gratuitement le badge CarteAsso au site de votre association, ou intégrez la liste des associations de votre commune sur le site de la mairie.",
      canonical: `${BASE}/badge`, body,
      share: this.shareBar(`${BASE}/badge`, "Votre asso est sur CarteAsso ? Ajoutez le badge :"),
    });
  }

  // Les chiffres nationaux coûtent quelques secondes (1,9 M lignes) : cache 6 h.
  private chiffresCache: { at: number; html: string } | null = null;

  /** Page /chiffres : « Les associations en France en chiffres ». Pensée pour être
   *  CITÉE (journalistes, IA) : chiffres sourcés, datés, phrases autonomes, Dataset. */
  async chiffresPage(): Promise<string> {
    if (this.chiffresCache && Date.now() - this.chiffresCache.at < 6 * 3600 * 1000) return this.chiffresCache.html;
    const tot = (await this.db.execute<{ total: number; site: number; social: number; helloasso: number }>(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE COALESCE(social,'{}'::jsonb) ? 'website' OR website IS NOT NULL)::int AS site,
        count(*) FILTER (WHERE COALESCE(social,'{}'::jsonb) ?| array['facebook','instagram'])::int AS social,
        count(*) FILTER (WHERE COALESCE(social,'{}'::jsonb) ? 'helloasso')::int AS helloasso
      FROM associations WHERE status = 'published'
    `)).rows[0];
    const cats = (await this.db.execute<{ category_id: string; n: number }>(sql`
      SELECT category_id, count(*)::int AS n FROM associations
      WHERE status = 'published' GROUP BY category_id ORDER BY n DESC
    `)).rows;
    const depts = (await this.db.execute<{ department: string; n: number }>(sql`
      SELECT department, count(*)::int AS n FROM associations
      WHERE status = 'published' AND department IS NOT NULL GROUP BY department ORDER BY n DESC
    `)).rows.filter((r) => SEO_DEPARTEMENTS[r.department]);
    const communes = await this.allCommunes();
    const topCommunes = communes.slice(0, 20);

    const fr = (n: number) => n.toLocaleString("fr-FR");
    const pct = (n: number) => (tot.total ? ((n / tot.total) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "0");
    const today = new Date().toISOString().slice(0, 10);
    const dateFr = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

    const byRegion: Record<string, number> = {};
    for (const d of depts) {
      const r = SEO_DEPARTEMENTS[d.department].region;
      byRegion[r] = (byRegion[r] ?? 0) + d.n;
    }
    const regions = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
    const topDept = depts[0] ? SEO_DEPARTEMENTS[depts[0].department] : null;
    const topCat = cats[0] ? (CAT_LABEL[cats[0].category_id] ?? cats[0].category_id) : null;

    const faq: [string, string][] = [
      ["Combien y a-t-il d'associations en France ?",
        `Au ${dateFr}, CarteAsso recense ${fr(tot.total)} associations actives en France (métropole et outre-mer), à partir du Répertoire National des Associations (RNA) publié par le ministère de l'Intérieur.`],
      ["Quel département compte le plus d'associations ?",
        topDept ? `Le département qui compte le plus d'associations est ${topDept.nom} (${topDept.region}), avec ${fr(depts[0].n)} associations référencées sur CarteAsso.` : ""],
      ["Quel est le domaine associatif le plus répandu ?",
        topCat ? `Le domaine le plus représenté est « ${topCat} », avec ${fr(cats[0].n)} associations, soit ${pct(cats[0].n)} % du total.` : ""],
      ["Combien d'associations ont un site internet ?",
        `${fr(tot.site)} associations (${pct(tot.site)} %) ont un site internet vérifié sur CarteAsso, et ${fr(tot.social)} (${pct(tot.social)} %) une page Facebook ou Instagram.`],
    ].filter(([, a]) => a) as [string, string][];

    const catRows = cats.map((r) =>
      `<tr><td>${esc(CAT_LABEL[r.category_id] ?? "Autre")}</td><td class="n">${fr(r.n)}</td><td class="n">${pct(r.n)} %</td></tr>`).join("");
    const regRows = regions.map(([r, n]) => `<tr><td>${esc(r)}</td><td class="n">${fr(n)}</td></tr>`).join("");
    const depRows = depts.map((d) => {
      const m = SEO_DEPARTEMENTS[d.department];
      return `<tr><td><a href="/${m.slug}">${esc(m.nom)}</a> (${esc(d.department)})</td><td class="n">${fr(d.n)}</td></tr>`;
    }).join("");
    const comRows = topCommunes.map((c) =>
      `<tr><td><a href="/${c.deptSlug}/${c.slug}">${esc(c.display)}</a> (${esc(SEO_DEPARTEMENTS[c.dept].nom)})</td><td class="n">${fr(c.n)}</td></tr>`).join("");

    const jsonld = JSON.stringify([
      {
        "@context": "https://schema.org", "@type": "Dataset",
        name: "Les associations en France : nombre par département, région et domaine",
        description: `Statistiques des ${fr(tot.total)} associations actives en France, issues du RNA et enrichies par CarteAsso (domaine d'activité, site web, réseaux sociaux).`,
        url: `${BASE}/chiffres`, dateModified: today, inLanguage: "fr-FR",
        license: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
        isAccessibleForFree: true, creator: { "@id": `${BASE}/#org` },
        spatialCoverage: { "@type": "Place", name: "France" },
        isBasedOn: "https://www.data.gouv.fr/fr/datasets/repertoire-national-des-associations/",
        variableMeasured: ["nombre d'associations", "domaine d'activité", "département", "région", "présence en ligne"],
      },
      { "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
      this.breadcrumb([["Accueil", `${BASE}/`], ["Les associations en chiffres", `${BASE}/chiffres`]]),
    ]);

    const body = `
<h1>Les associations en France en chiffres</h1>
<p class="lead">Combien d'associations en France, dans quels domaines, dans quels territoires ? Chiffres mis à jour le <strong>${esc(dateFr)}</strong>, à partir du Répertoire National des Associations (RNA) enrichi par CarteAsso. Réutilisation libre avec la mention « CarteAsso — ${HOST} ».</p>
<div class="kpis">
<div><b>${fr(tot.total)}</b><span>associations actives</span></div>
<div><b>${fr(communes.length)}</b><span>communes couvertes</span></div>
<div><b>${pct(tot.site)} %</b><span>ont un site internet</span></div>
<div><b>${pct(tot.social)} %</b><span>sont sur Facebook ou Instagram</span></div>
</div>
${faq.map(([q, a]) => `<h2>${esc(q)}</h2>\n<p class="lead">${esc(a)}</p>`).join("\n")}
<h2>Associations par domaine d'activité</h2>
<table class="stats"><thead><tr><th>Domaine</th><th>Associations</th><th>Part</th></tr></thead><tbody>${catRows}</tbody></table>
<h2>Associations par région</h2>
<table class="stats"><thead><tr><th>Région</th><th>Associations</th></tr></thead><tbody>${regRows}</tbody></table>
<h2>Les 20 communes qui comptent le plus d'associations</h2>
<table class="stats"><thead><tr><th>Commune</th><th>Associations</th></tr></thead><tbody>${comRows}</tbody></table>
<h2>Associations par département</h2>
<table class="stats"><thead><tr><th>Département</th><th>Associations</th></tr></thead><tbody>${depRows}</tbody></table>
<div class="box"><h2>Méthode</h2><p class="lead" style="margin:0">Source : RNA (data.gouv.fr), associations au statut actif. Le domaine d'activité est déduit de l'objet social déclaré ; sites et réseaux sociaux sont recherchés puis vérifiés un par un avant publication. Données ouvertes sous Licence Ouverte 2.0.</p></div>`;
    const html = this.doc({
      title: `Combien d'associations en France ? Les chiffres ${new Date().getFullYear()} | CarteAsso`,
      desc: `${fr(tot.total)} associations actives en France : répartition par domaine, région, département et commune. Chiffres ouverts et mis à jour, issus du RNA.`,
      canonical: `${BASE}/chiffres`, jsonld, body, og: `${BASE}/og/chiffres.png`,
      share: this.shareBar(`${BASE}/chiffres`, `${fr(tot.total)} associations en France : les chiffres par département et par domaine`),
    });
    this.chiffresCache = { at: Date.now(), html };
    return html;
  }

  /** Image de partage PNG d'une page : /og/chiffres.png, /og/<dept>.png,
   *  /og/<dept>/<commune|thème>.png. null si la page n'existe pas. */
  async ogImage(deptSlug: string, slug?: string): Promise<Buffer | null> {
    // Nombre « 12 345 » avec une espace simple (la police n'a pas l'espace fine insécable).
    const fr = (n: number) => n.toLocaleString("fr-FR").replace(/\s/g, " ");
    const key = `${deptSlug}/${slug ?? ""}`;
    if (deptSlug === "chiffres" && !slug) {
      const total = (await this.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM associations WHERE status = 'published'`)).rows[0]?.n ?? 0;
      return renderOg(key, { big: fr(total), line1: "associations en France", line2: "Les chiffres, département par département", host: HOST });
    }
    const deptCode = SEO_CODE_BY_SLUG[deptSlug];
    if (!deptCode) return null;
    const { nom, region } = SEO_DEPARTEMENTS[deptCode];
    const communes = (await this.allCommunes()).filter((c) => c.dept === deptCode);
    if (!slug) {
      const total = communes.reduce((s, c) => s + c.n, 0);
      return renderOg(key, { big: fr(total), line1: `associations · ${nom}`, line2: `${communes.length} communes · ${region}`, host: HOST });
    }
    const catId = CAT_BY_SLUG[slug];
    if (catId) {
      const n = (await this.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM associations
        WHERE department = ${deptCode} AND category_id = ${catId} AND status = 'published'`)).rows[0]?.n ?? 0;
      if (!n) return null;
      return renderOg(key, { big: fr(n), line1: `associations ${CAT_GENRE[catId] ?? ""}`.trim(), line2: `${nom} · ${region}`, host: HOST });
    }
    const c = communes.find((x) => x.slug === slug);
    if (!c) return null;
    return renderOg(key, { big: fr(c.n), line1: `association${c.n > 1 ? "s" : ""} à ${c.display}`, line2: `${nom} · ${region}`, host: HOST });
  }

  /** robots.txt : tout le monde est bienvenu, y compris les robots des IA
   *  (on VEUT être cité par ChatGPT, Claude, Perplexity, Gemini, Mistral…). */
  robots(): string {
    const ia = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot",
      "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended",
      "MistralAI-User", "CCBot", "Bytespider", "Amazonbot", "meta-externalagent", "DuckAssistBot", "cohere-ai"];
    return [
      "# CarteAsso — robots.txt",
      "# Moteurs de recherche ET assistants IA : bienvenue. Les données sont ouvertes",
      `# (Licence Ouverte 2.0) : citez « CarteAsso — ${HOST} ». Résumé pour les IA : ${BASE}/llms.txt`,
      "",
      "User-agent: *",
      "Allow: /",
      "Disallow: /embed/",
      "",
      ...ia.flatMap((b) => [`User-agent: ${b}`, "Allow: /", ""]),
      `Sitemap: ${BASE}/sitemap.xml`,
      "",
    ].join("\n");
  }

  /** llms.txt (standard llmstxt.org) : la fiche d'identité du site pour les IA,
   *  avec les chiffres du jour pour qu'elles citent des données à jour. */
  async llms(): Promise<string> {
    const communes = await this.allCommunes();
    const total = communes.reduce((s, c) => s + c.n, 0);
    const fr = (n: number) => n.toLocaleString("fr-FR");
    const ex = communes[0];
    const exDept = ex ? SEO_DEPARTEMENTS[ex.dept] : null;
    const exUrl = ex ? `${BASE}/${ex.deptSlug}/${ex.slug}` : `${BASE}/territoires`;
    return `# CarteAsso

> CarteAsso (${HOST}) est la carte interactive et gratuite de toutes les associations de France, métropole et outre-mer : ${fr(total)} associations actives dans ${fr(communes.length)} communes. Pour chaque commune, la liste des associations par domaine (sport, culture, environnement, vie locale, solidarité, éducation, patrimoine), avec leur site internet et leurs réseaux sociaux quand ils ont été vérifiés.

CarteAsso est un projet bénévole et open source. Les données viennent du Répertoire National des Associations (RNA, ministère de l'Intérieur, data.gouv.fr) et sont enrichies par CarteAsso : domaine d'activité, site web et réseaux sociaux recherchés puis vérifiés un par un.

Pour répondre à « quelles associations à <commune> ? », « association de <sport/activité> près de <ville> », « combien d'associations en France / dans <département> ? », les pages ci-dessous donnent des réponses à jour et citables.

## Pages clés

- [Carte interactive](${BASE}/): trouver les associations près de chez soi sur une carte de France.
- [Les associations en France en chiffres](${BASE}/chiffres): nombre d'associations par domaine, région, département et commune (mis à jour en continu).
- [Associations par commune](${BASE}/territoires): index de tous les départements et communes couverts.
- [Plan du site](${BASE}/sitemap.xml): toutes les pages communes, départements et thèmes.

## Chercher une association (sans JavaScript)

- Recherche : ${BASE}/recherche?q=<mots-clés>&lieu=<commune ou code postal> — ex. ${BASE}/recherche?q=judo&lieu=Challans. Les associations les plus proches du lieu d'abord, avec leur site et leurs réseaux sociaux vérifiés. Paramètres facultatifs : categorie (sport, cult, eco, social, soli, edu, patri), departement (code, ex. 85). Une phrase marche aussi : ${BASE}/recherche?q=club+de+voile+à+Vannes.
- Fiche d'une association : ${BASE}/association/<id> (lien donné par chaque résultat) : nom, domaine, commune, objet officiel (RNA), numéro RNA, site, réseaux sociaux, contacts.
- Pour répondre à « je cherche une association de <activité> à <ville> », ouvrir la page de recherche correspondante puis citer les fiches.
- Même chose en JSON : ${BASE}/api/v1/recherche?q=judo&lieu=Challans et ${BASE}/api/v1/associations/<id> (API publique sans clé, description OpenAPI : ${BASE}/openapi.json, documentation : ${BASE}/developpeurs).

## Comment sont construites les URL

- Page commune : ${BASE}/<departement>/<commune> — ex. ${exUrl}${ex && exDept ? ` (${fr(ex.n)} associations à ${ex.display}, ${exDept.nom})` : ""}.
- Page département : ${BASE}/<departement> — ex. ${BASE}/${exDept?.slug ?? "vendee"}.
- Page thème × département : ${BASE}/<departement>/associations-sportives (aussi : -culturelles, -environnement, -vie-locale, -solidarite, -education, -patrimoine).
- Les slugs sont en minuscules, sans accents, mots séparés par des tirets (Saint-Étienne → saint-etienne).

## Citer et réutiliser

- Mention à utiliser : « Source : CarteAsso — ${HOST} (d'après le RNA) ».
- Données RNA et enrichissements CarteAsso : Licence Ouverte 2.0 (Etalab), réutilisation libre avec mention de la source.
- Code de l'application : PolyForm Noncommercial 1.0.0 — https://github.com/King4Kats/CarteAsso

## Optional

- [Badge et carte à intégrer](${BASE}/badge): badge « Référencée sur CarteAsso » pour les associations, liste intégrable pour les mairies.
`;
  }

  /** Slug d'URL d'une catégorie (pour le routeur/contrôleur). */
  isCategorySlug(slug: string): boolean {
    return slug in CAT_BY_SLUG;
  }

  /** Page CATÉGORIE × DÉPARTEMENT : /<deptSlug>/associations-sportives, etc.
   *  Riche (toutes les communes du dépt ayant ce thème + un échantillon d'assos),
   *  pour capter « associations sportives <département> ». null si inconnu/vide. */
  async deptCategoryPage(deptSlug: string, catSlug: string): Promise<string | null> {
    const deptCode = SEO_CODE_BY_SLUG[deptSlug];
    const catId = CAT_BY_SLUG[catSlug];
    if (!deptCode || !catId) return null;
    const { nom: deptNom, region } = SEO_DEPARTEMENTS[deptCode];
    const genre = CAT_GENRE[catId] ?? (CAT_LABEL[catId] ?? "").toLowerCase();

    // Communes du département ayant au moins une asso de ce thème (avec compte).
    const grp = await this.db.execute<{ city: string; n: number }>(sql`
      SELECT city, count(*)::int AS n
      FROM associations
      WHERE department = ${deptCode} AND category_id = ${catId} AND status = 'published'
        AND city IS NOT NULL AND length(trim(city)) > 0
      GROUP BY city ORDER BY count(*) DESC, city ASC
    `);
    if (!grp.rows.length) return null; // pas de page si aucune asso de ce thème (pas de page maigre)
    const total = grp.rows.reduce((s, r) => s + r.n, 0);
    const nbCommunes = grp.rows.length;

    // Slug officiel de chaque commune (réutilise le dédoublonnage d'allCommunes).
    const slugByCity = new Map<string, string>();
    for (const c of (await this.allCommunes()).filter((x) => x.dept === deptCode)) slugByCity.set(c.city, c.slug);

    // Échantillon d'associations du thème (nom + ville), pour du contenu réel + ItemList.
    const assoRows = await this.db.execute<{ name: string; city: string }>(sql`
      SELECT name, city FROM associations
      WHERE department = ${deptCode} AND category_id = ${catId} AND status = 'published'
        AND city IS NOT NULL AND length(trim(city)) > 0
      ORDER BY name ASC LIMIT ${MAX_LISTE}
    `);
    const lis = assoRows.rows.map((a) =>
      `  <li><span class="nom">${esc(a.name)}</span> <span class="cat">· ${esc(cleanCity(a.city))}</span></li>`,
    ).join("\n");
    const reste = total > assoRows.rows.length
      ? `<p class="lead">… et ${total - assoRows.rows.length} autres associations ${esc(genre)} dans le département, à explorer sur la <a href="/">carte interactive</a>.</p>` : "";

    // Maillage : communes du thème (vers la page commune) + autres thèmes du département.
    const communeLinks = grp.rows.map((r) => {
      const sl = slugByCity.get(r.city);
      const lbl = `${esc(cleanCity(r.city))} <span class="c">${r.n}</span>`;
      return sl ? `<a href="/${deptSlug}/${sl}">${lbl}</a>` : `<span>${lbl}</span>`;
    }).join("\n");
    const autresThemes = CAT_ORDER.filter((id) => id !== catId).map((id) =>
      `<a href="/${deptSlug}/${CAT_SLUG[id]}">Associations ${esc(CAT_GENRE[id] ?? CAT_LABEL[id])} — ${esc(deptNom)}</a>`,
    ).join("");

    const faq: [string, string][] = [
      [
        `Combien d'associations ${genre} y a-t-il dans le département ${deptNom} ?`,
        `Le département ${deptNom} (${region}) compte ${total} association${total > 1 ? "s" : ""} ${genre} réparties dans ${nbCommunes} commune${nbCommunes > 1 ? "s" : ""}, référencées sur CarteAsso.`,
      ],
      [
        `Comment trouver une association ${genre} près de chez moi (${deptNom}) ?`,
        `Choisissez votre commune dans la liste ci-dessous, ou utilisez la carte interactive de CarteAsso pour localiser les associations ${genre} du département ${deptNom} et accéder à leurs coordonnées.`,
      ],
    ];
    const faqHtml = `<h2>Questions fréquentes</h2>\n` +
      faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p class="lead">${esc(a)}</p>`).join("\n");

    const title = `Associations ${genre} — ${deptNom} | CarteAsso`;
    const desc = `Les ${total} associations ${genre} du département ${deptNom} (${region}), dans ${nbCommunes} communes. Trouvez une association ${genre} près de chez vous sur CarteAsso.`;
    const jsonld = JSON.stringify([
      {
        "@context": "https://schema.org", "@type": "ItemList",
        name: `Associations ${genre} — ${deptNom}`, numberOfItems: total,
        itemListElement: assoRows.rows.slice(0, 100).map((a, i) => ({ "@type": "ListItem", position: i + 1, name: a.name })),
      },
      this.breadcrumb([
        ["Accueil", `${BASE}/`],
        [deptNom, `${BASE}/${deptSlug}`],
        [`Associations ${genre}`, `${BASE}/${deptSlug}/${catSlug}`],
      ]),
      {
        "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
    ]);
    const body = `
<h1>Associations ${esc(genre)} — ${esc(deptNom)}</h1>
<p class="lead">${total} <strong>association${total > 1 ? "s" : ""} ${esc(genre)}</strong> référencée${total > 1 ? "s" : ""} dans le département ${esc(deptNom)} (${esc(region)}), réparties dans ${nbCommunes} commune${nbCommunes > 1 ? "s" : ""}. Choisissez une commune ou explorez la <a href="/">carte interactive</a>. Voir aussi <a href="/${deptSlug}">toutes les communes — ${esc(deptNom)}</a>.</p>
<h2>Associations ${esc(genre)} par commune — ${esc(deptNom)}</h2>
<div class="grid">
${communeLinks}
</div>
<h2>Quelques associations ${esc(genre)} du ${esc(deptNom)}</h2>
<ul class="assos">
${lis}
</ul>
${reste}
${faqHtml}
<p class="lead" style="margin-top:32px">Autres thèmes — ${esc(deptNom)} :</p>
<div class="deps">${autresThemes}</div>`;
    return this.doc({
      title, desc, canonical: `${BASE}/${deptSlug}/${catSlug}`, jsonld, body,
      og: `${BASE}/og/${deptSlug}/${catSlug}.png`,
      share: this.shareBar(`${BASE}/${deptSlug}/${catSlug}`, `Les ${total} associations ${genre} — ${deptNom} :`),
    });
  }

  /** Index d'un département : /<deptSlug> (liste de ses communes). null si inconnu. */
  async deptIndex(deptSlug: string): Promise<string | null> {
    const deptCode = SEO_CODE_BY_SLUG[deptSlug];
    if (!deptCode) return null;
    const { nom } = SEO_DEPARTEMENTS[deptCode];
    const communes = (await this.allCommunes()).filter((c) => c.dept === deptCode);
    const total = communes.reduce((s, c) => s + c.n, 0);
    const liens = communes.map((c) =>
      `  <a href="/${c.deptSlug}/${c.slug}">${esc(c.display)} <span class="c">${c.n}</span></a>`,
    ).join("\n");
    const title = `Associations par commune — ${nom} — CarteAsso`;
    const desc = `${nom} : ${communes.length} communes et leurs ${total} associations référencées — trouvez les assos près de chez vous.`;
    const jsonld = JSON.stringify(this.breadcrumb([
      ["Accueil", `${BASE}/`],
      [nom, `${BASE}/${deptSlug}`],
    ]));
    const themeLinks = CAT_ORDER.map((id) =>
      `<a href="/${deptSlug}/${CAT_SLUG[id]}">Associations ${esc(CAT_GENRE[id] ?? CAT_LABEL[id])} — ${esc(nom)}</a>`,
    ).join("");
    const body = `
<h1>${esc(nom)} — associations par commune</h1>
<p class="lead">${communes.length} communes · ${total} associations référencées. Choisissez une commune, parcourez par thème, ou explorez la <a href="/">carte interactive</a>.</p>
<p class="lead" style="margin-top:0">Par thème :</p>
<div class="deps">${themeLinks}</div>
<div class="grid" style="margin-top:24px">
${liens}
</div>
<p class="lead" style="margin-top:32px">Autres territoires couverts :</p>
${this.autresDepts(deptSlug)}`;
    return this.doc({
      title, desc, canonical: `${BASE}/${deptSlug}`, jsonld, body,
      og: `${BASE}/og/${deptSlug}.png`,
      share: this.shareBar(`${BASE}/${deptSlug}`, `Les ${total} associations — ${nom}, commune par commune :`),
    });
  }

  /** Index RACINE : tous les territoires couverts (départements), groupés par région. */
  async rootIndex(): Promise<string> {
    const communes = await this.allCommunes();
    const byDept: Record<string, { communes: number; assos: number }> = {};
    for (const c of communes) {
      const e = (byDept[c.dept] ??= { communes: 0, assos: 0 });
      e.communes += 1; e.assos += c.n;
    }
    const byRegion: Record<string, string[]> = {};
    for (const code of SEO_DEPT_CODES) {
      (byRegion[SEO_DEPARTEMENTS[code].region] ??= []).push(code);
    }
    const sections = Object.entries(byRegion).map(([region, codes]) => {
      const cards = codes.map((code) => {
        const d = SEO_DEPARTEMENTS[code];
        const stat = byDept[code] ?? { communes: 0, assos: 0 };
        return `  <a href="/${d.slug}">${esc(d.nom)} <span class="c">${stat.assos} assos · ${stat.communes} communes</span></a>`;
      }).join("\n");
      return `<h2 style="font-size:18px;margin:28px 0 12px;font-weight:800">${esc(region)}</h2>\n<div class="grid">\n${cards}\n</div>`;
    }).join("\n");
    const totalAssos = Object.values(byDept).reduce((s, e) => s + e.assos, 0);
    const title = "Associations par commune en France — CarteAsso";
    const desc = `Trouvez les associations près de chez vous : ${communes.length} communes, ${totalAssos} associations référencées partout en France.`;
    const body = `
<h1>Associations par commune</h1>
<p class="lead">${communes.length} communes · ${totalAssos} associations référencées. Choisissez votre territoire, ou explorez la <a href="/">carte interactive</a>.</p>
${sections}`;
    return this.doc({ title, desc, canonical: `${BASE}/territoires`, body });
  }

  // Découpage du sitemap : Google limite à 50 000 URL/fichier. ~49k communes -> on
  // passe par un sitemap INDEX qui pointe vers des sous-sitemaps de 20 000 URL.
  private readonly SITEMAP_CHUNK = 20000;

  /** Toutes les URL du sitemap (accueil + racine + départements + thèmes + communes). */
  private async sitemapUrls(): Promise<{ urls: string[]; mod: string }> {
    const communes = await this.allCommunes();
    const mod = communes.reduce((m, c) => (c.updated > m ? c.updated : m), "2024-01-01");
    // Pages catégorie×département (uniquement les combos qui ont des assos).
    const inList = SEO_DEPT_CODES.map((c) => `'${c}'`).join(",");
    const cat = await this.db.execute<{ department: string; category_id: string }>(sql.raw(`
      SELECT department, category_id FROM associations
      WHERE department IN (${inList}) AND status = 'published'
      GROUP BY department, category_id`));
    const catUrls = cat.rows
      .filter((r) => SEO_DEPARTEMENTS[r.department] && CAT_SLUG[r.category_id])
      .map((r) => `<url><loc>${BASE}/${SEO_DEPARTEMENTS[r.department].slug}/${CAT_SLUG[r.category_id]}</loc><lastmod>${mod}</lastmod><changefreq>weekly</changefreq><priority>0.65</priority></url>`);
    const urls = [
      `<url><loc>${BASE}/</loc><lastmod>${mod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
      `<url><loc>${BASE}/chiffres</loc><lastmod>${mod}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`,
      `<url><loc>${BASE}/badge</loc><lastmod>${mod}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`,
      `<url><loc>${BASE}/territoires</loc><lastmod>${mod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
      ...Object.values(SEO_DEPARTEMENTS).map((d) =>
        `<url><loc>${BASE}/${d.slug}</loc><lastmod>${mod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
      ...catUrls,
      ...communes.map((c) =>
        `<url><loc>${BASE}/${c.deptSlug}/${c.slug}</loc><lastmod>${c.updated}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`),
    ];
    return { urls, mod };
  }

  // Fiches d'associations dans le sitemap : seulement les « riches » (site ou réseau social
  // vérifié, ~220 000 en 11/2026). Les autres fiches restent trouvables par les liens des
  // pages communes. Le nombre change peu : recalculé toutes les 6 h.
  private readonly RICHE = sql`(coalesce(website, '') <> '' OR coalesce(social, '{}'::jsonb) ?| array['website','facebook','instagram','helloasso'])`;
  private nbRiches: { at: number; n: number } | null = null;
  private async nombreFichesRiches(): Promise<number> {
    if (this.nbRiches && Date.now() - this.nbRiches.at < 6 * 3600 * 1000) return this.nbRiches.n;
    const r = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM associations WHERE status = 'published' AND ${this.RICHE}`);
    this.nbRiches = { at: Date.now(), n: r.rows[0]?.n ?? 0 };
    return this.nbRiches.n;
  }

  /** /sitemap-asso-N.xml = une tranche de 20 000 fiches d'associations. */
  async sitemapAssoChunk(n: number): Promise<string> {
    const r = await this.db.execute<{ id: string; updated: unknown }>(sql`
      SELECT id, updated_at AS updated FROM associations
      WHERE status = 'published' AND ${this.RICHE}
      ORDER BY id
      LIMIT ${this.SITEMAP_CHUNK} OFFSET ${Math.max(0, n) * this.SITEMAP_CHUNK}`);
    const urls = r.rows.map((a) =>
      `<url><loc>${BASE}/association/${a.id}</loc><lastmod>${isoDate(a.updated)}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  }

  /** /sitemap.xml = sitemap INDEX : liste les sous-sitemaps /sitemap-N.xml et /sitemap-asso-N.xml. */
  async sitemap(): Promise<string> {
    const { urls, mod } = await this.sitemapUrls();
    const n = Math.max(1, Math.ceil(urls.length / this.SITEMAP_CHUNK));
    const nAsso = Math.ceil((await this.nombreFichesRiches()) / this.SITEMAP_CHUNK);
    const items = [
      ...Array.from({ length: n }, (_, i) =>
        `<sitemap><loc>${BASE}/sitemap-${i}.xml</loc><lastmod>${mod}</lastmod></sitemap>`),
      ...Array.from({ length: nAsso }, (_, i) =>
        `<sitemap><loc>${BASE}/sitemap-asso-${i}.xml</loc><lastmod>${mod}</lastmod></sitemap>`),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`;
  }

  /** /sitemap-N.xml = une tranche de 20 000 URL. */
  async sitemapChunk(n: number): Promise<string> {
    const { urls } = await this.sitemapUrls();
    const slice = urls.slice(n * this.SITEMAP_CHUNK, (n + 1) * this.SITEMAP_CHUNK);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${slice.join("\n")}\n</urlset>\n`;
  }
}
