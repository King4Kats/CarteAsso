/**
 * Pages HTML « pour les IA et les moteurs » : lisibles sans JavaScript, faciles à citer.
 *   /recherche?q=judo&lieu=Challans  -> résultats d'une recherche (une IA peut fabriquer l'URL)
 *   /association/<id>                -> fiche d'une association (page de référence à citer)
 * Même gabarit que les pages communes (SeoService.doc).
 */
import { Injectable } from "@nestjs/common";
import { CATEGORIES } from "@carteasso/shared";
import { BASE, HOST, SeoService, esc } from "../seo/seo.service";
import { OuvertService, type AssoOuverte, type ParamsRecherche } from "./ouvert.service";

@Injectable()
export class PagesOuvertes {
  constructor(private readonly seo: SeoService, private readonly ouvert: OuvertService) {}

  /** Page de recherche. Jamais indexée (une infinité d'URL possibles), mais ses liens sont suivis. */
  async recherche(p: ParamsRecherche): Promise<string> {
    // Une phrase entière dans q (« club de voile à Vannes ») : on en tire le lieu.
    if (p.q?.trim() && !p.lieu?.trim()) {
      const d = this.ouvert.decouper(p.q);
      if (d.lieu) p = { ...p, q: d.q ?? undefined, lieu: d.lieu };
    }
    const vide = !p.q?.trim() && !p.lieu?.trim() && !p.categorie && !p.departement;
    const r = vide ? null : await this.ouvert.rechercher({ ...p, limite: 30 });
    const quoi = p.q?.trim() ? `« ${p.q.trim()} »` : "associations";
    const ou = r?.lieu_trouve ? ` à ${r.lieu_trouve.nom}` : p.lieu?.trim() ? ` à ${p.lieu.trim()}` : "";
    const title = vide ? "Rechercher une association — CarteAsso" : `Associations ${quoi}${ou} — CarteAsso`;

    const options = CATEGORIES.map((c) =>
      `<option value="${c.id}"${p.categorie === c.id ? " selected" : ""}>${esc(c.label)}</option>`).join("");
    const formulaire = `
<form method="get" action="/recherche" class="box" style="margin-top:0">
  <p style="margin:0 0 10px"><label>Quoi ? <input name="q" value="${esc(p.q ?? "")}" placeholder="judo, théâtre, aide aux devoirs…" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:10px"></label></p>
  <p style="margin:0 0 10px"><label>Où ? <input name="lieu" value="${esc(p.lieu ?? "")}" placeholder="commune ou code postal" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:10px"></label></p>
  <p style="margin:0 0 12px"><label>Domaine : <select name="categorie" style="padding:8px;border-radius:10px"><option value="">tous</option>${options}</select></label></p>
  <button class="cta" style="border:0;cursor:pointer">Rechercher</button>
</form>`;

    let resultats = "";
    if (r) {
      const lignes = r.resultats.map((a) => this.ligne(a)).join("\n");
      const entete = r.nombre
        ? `<p class="lead">${r.nombre} association${r.nombre > 1 ? "s" : ""} ${quoi === "associations" ? "" : `pour ${esc(quoi)} `}${r.lieu_trouve ? `autour de <strong>${esc(r.lieu_trouve.nom)}</strong>${r.lieu_trouve.codePostal ? ` (${esc(r.lieu_trouve.codePostal)})` : ""}, de la plus proche à la plus éloignée` : ""}.</p>`
        : `<p class="lead">Aucune association trouvée. Essayez un mot plus simple (« foot » plutôt que « club de football féminin ») ou une commune voisine.</p>`;
      resultats = `${r.remarque ? `<p class="lead">${esc(r.remarque)}</p>` : ""}${entete}\n<ul class="assos">\n${lignes}\n</ul>`;
    }

    const body = `
<h1>${vide ? "Rechercher une association" : esc(`Associations ${quoi}${ou}`)}</h1>
${formulaire}
${resultats}
<div class="box">
  <h2>Pour les assistants et les outils</h2>
  <p class="lead" style="margin:0">Cette page se construit directement par son adresse : <code>${BASE}/recherche?q=&lt;mots-clés&gt;&amp;lieu=&lt;commune ou code postal&gt;</code> (paramètres facultatifs : <code>categorie</code> = ${CATEGORIES.map((c) => c.id).join(", ")} ; <code>departement</code> = code, ex. 85). Chaque résultat renvoie vers une fiche à citer : « Source : CarteAsso — ${HOST} ».</p>
</div>`;
    return this.seo.doc({
      title,
      desc: vide
        ? "Recherchez parmi toutes les associations de France par activité et par commune : sport, culture, solidarité, environnement, éducation, patrimoine."
        : `${title}. Coordonnées, site internet et réseaux sociaux vérifiés, d'après le Répertoire National des Associations.`,
      canonical: r?.url ?? `${BASE}/recherche`,
      body,
      robots: vide ? "index, follow" : "noindex, follow",
    });
  }

  /** Une association dans une liste de résultats. */
  private ligne(a: AssoOuverte): string {
    const lieu = [a.commune, a.code_postal].filter(Boolean).join(" ");
    const dist = a.distance_km != null ? ` · ${a.distance_km.toLocaleString("fr-FR")} km` : "";
    const site = a.site_web ? ` <a href="${esc(a.site_web)}" rel="nofollow noopener" target="_blank">site</a>` : "";
    const desc = a.description ? `<br><span class="cat">${esc(a.description.slice(0, 180))}${a.description.length > 180 ? "…" : ""}</span>` : "";
    return `  <li><a class="nom" href="/association/${a.id}" style="color:inherit;font-size:inherit;margin:0">${esc(a.nom)}</a> <span class="cat">· ${esc(a.categorie)}${lieu ? ` · ${esc(lieu)}` : ""}${dist}</span>${site}${desc}</li>`;
  }

  /** Fiche d'une association. null = inconnue (404). */
  async association(id: string): Promise<string | null> {
    const a = await this.ouvert.fiche(id);
    if (!a) return null;
    const lieu = [a.commune, a.code_postal].filter(Boolean).join(" ");
    const liens: [string, string | null][] = [
      ["Site internet", a.site_web], ["Facebook", a.facebook], ["Instagram", a.instagram], ["HelloAsso", a.helloasso],
    ];
    const liensHtml = liens.filter(([, u]) => u)
      .map(([nom, u]) => `<li><span class="nom">${nom}</span> <a href="${esc(u!)}" rel="nofollow noopener" target="_blank">${esc(u!)}</a></li>`).join("\n");
    const contact = [
      a.email ? `<li><span class="nom">E-mail</span> <a href="mailto:${esc(a.email)}">${esc(a.email)}</a></li>` : "",
      a.telephone ? `<li><span class="nom">Téléphone</span> ${esc(a.telephone)}</li>` : "",
    ].join("");
    const riche = Boolean(a.description || liensHtml || contact);
    const titre = `${a.nom}${a.commune ? ` — association à ${a.commune}` : ""}`;
    const desc = a.description
      ? `${a.nom} (${a.categorie.toLowerCase()}${a.commune ? `, ${a.commune}` : ""}) : ${a.description.slice(0, 140)}`
      : `${a.nom} : association ${a.categorie.toLowerCase()}${a.commune ? ` à ${a.commune}` : ""}. Coordonnées et liens sur CarteAsso.`;
    const jsonld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "NGO",
      "@id": a.url,
      name: a.nom,
      url: a.site_web ?? a.url,
      ...(a.description ? { description: a.description } : {}),
      ...(a.numero_rna ? { identifier: { "@type": "PropertyValue", propertyID: "RNA", value: a.numero_rna } } : {}),
      address: {
        "@type": "PostalAddress", addressCountry: "FR",
        ...(a.commune ? { addressLocality: a.commune } : {}),
        ...(a.code_postal ? { postalCode: a.code_postal } : {}),
      },
      ...(a.email ? { email: a.email } : {}),
      ...(a.telephone ? { telephone: a.telephone } : {}),
      sameAs: [a.site_web, a.facebook, a.instagram, a.helloasso].filter(Boolean),
      subjectOf: { "@type": "WebPage", url: a.url, publisher: { "@id": `${BASE}/#org` } },
    });
    const body = `
<h1>${esc(a.nom)}</h1>
<p class="lead">Association <strong>${esc(a.categorie.toLowerCase())}</strong>${lieu ? ` à <strong>${esc(lieu)}</strong>` : ""}${a.departement ? ` (département ${esc(a.departement)})` : ""}.${a.numero_rna ? ` Numéro RNA : ${esc(a.numero_rna)}.` : ""}</p>
${a.description ? `<h2>Présentation</h2>\n<p>${esc(a.description)}</p>` : ""}
${liensHtml || contact ? `<h2>Coordonnées et liens</h2>\n<ul class="assos">\n${liensHtml}\n${contact}\n</ul>` : `<p class="lead">Pas encore de site ni de réseau social vérifié pour cette association.</p>`}
<h2>Autour de ${esc(a.commune ?? "cette association")}</h2>
<div class="deps">${a.page_commune ? `<a href="${a.page_commune.replace(BASE, "")}">Toutes les associations de ${esc(a.commune ?? "la commune")}</a>` : ""}<a href="/recherche?lieu=${encodeURIComponent(a.code_postal ?? a.commune ?? "")}">Associations à proximité</a><a href="/">Carte interactive</a></div>
<p class="lead" style="margin-top:28px">Vous gérez cette association ? Ajoutez le <a href="/badge">badge « Référencée sur CarteAsso »</a> à votre site. Informations issues du Répertoire National des Associations et vérifiées par CarteAsso ; citer « Source : CarteAsso — ${HOST} ».</p>`;
    return this.seo.doc({
      title: titre,
      desc,
      canonical: a.url,
      jsonld,
      body,
      // Fiche sans aucune information en plus du nom : pas indexée (page trop pauvre),
      // mais toujours consultable et ses liens suivis.
      robots: riche ? undefined : "noindex, follow",
    });
  }
}
