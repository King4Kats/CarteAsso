/**
 * Routes SEO (HORS préfixe /api, voir main.ts) : pages indexables par Google.
 *   GET /sitemap.xml          -> plan du site (toutes les communes, tous départements)
 *   GET /<departement>        -> index des communes du département (ex. /vendee, /lot)
 *   GET /<departement>/<commune> -> page d'une commune (liste des assos en HTML)
 *   GET /chiffres, /badge, /robots.txt, /llms.txt, /embed/<d>/<c>, /og/…png (voir plus bas)
 *
 * On renvoie directement la chaîne HTML/XML ; @Header fixe le bon Content-Type.
 * nginx ne route que les slugs de départements couverts vers l'API (le reste = SPA).
 */
import { Controller, Get, Header, NotFoundException, Param, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { RechercheRateLimitGuard } from "../common/recherche-rate-limit.guard";
import { PagesOuvertes } from "../ouvert/ouvert.pages";
import { SeoService } from "./seo.service";

// Préfixe "seo" -> routes réelles /api/seo/... ; nginx réécrit les URL propres
// (/vendee/challans -> /api/seo/vendee/challans) pour que Google voie des URL propres.
@Controller("seo")
export class SeoController {
  constructor(private readonly svc: SeoService, private readonly pages: PagesOuvertes) {}

  @Get("sitemap.xml")
  @Header("Content-Type", "application/xml; charset=utf-8")
  sitemap(): Promise<string> {
    return this.svc.sitemap();
  }

  // Sous-sitemap (tranche). nginx réécrit /sitemap-3.xml -> /api/seo/sitemap-part/3.
  // Déclaré AVANT :dept pour ne pas être avalé par la route département.
  @Get("sitemap-part/:n")
  @Header("Content-Type", "application/xml; charset=utf-8")
  sitemapPart(@Param("n") n: string): Promise<string> {
    return this.svc.sitemapChunk(Number(n) || 0);
  }

  // Fiches d'associations du sitemap : nginx réécrit /sitemap-asso-3.xml -> /api/seo/sitemap-asso/3.
  @Get("sitemap-asso/:n")
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "public, max-age=86400")
  sitemapAsso(@Param("n") n: string): Promise<string> {
    return this.svc.sitemapAssoChunk(Number(n) || 0);
  }

  // Index racine de tous les territoires (défini AVANT :dept pour ne pas être avalé).
  @Get("territoires")
  @Header("Content-Type", "text/html; charset=utf-8")
  territoires(): Promise<string> {
    return this.svc.rootIndex();
  }

  // ── Pages et fichiers « fixes », déclarés AVANT :dept pour ne pas être avalés ──

  @Get("robots.txt")
  @Header("Content-Type", "text/plain; charset=utf-8")
  robots(): string {
    return this.svc.robots();
  }

  @Get("llms.txt")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  llms(): Promise<string> {
    return this.svc.llms();
  }

  // Recherche lisible sans JavaScript (/recherche?q=judo&lieu=Challans) : une IA peut
  // fabriquer l'adresse elle-même et lire les résultats. Paramètres tronqués à 100 caractères.
  @Get("recherche")
  @UseGuards(RechercheRateLimitGuard)
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=600")
  recherche(
    @Query("q") q?: string, @Query("lieu") lieu?: string,
    @Query("categorie") categorie?: string, @Query("departement") departement?: string,
  ): Promise<string> {
    const court = (v?: string) => (typeof v === "string" ? v.slice(0, 100) : undefined);
    return this.pages.recherche({ q: court(q), lieu: court(lieu), categorie: court(categorie), departement: court(departement)?.slice(0, 3) });
  }

  // Fiche d'une association : /association/<id> (page de référence à citer).
  @Get("association/:id")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  async association(@Param("id") id: string): Promise<string> {
    const html = await this.pages.association(id);
    if (!html) throw new NotFoundException("Association introuvable");
    return html;
  }

  @Get("chiffres")
  @Header("Content-Type", "text/html; charset=utf-8")
  chiffres(): Promise<string> {
    return this.svc.chiffresPage();
  }

  @Get("badge")
  @Header("Content-Type", "text/html; charset=utf-8")
  badge(): string {
    return this.svc.badgePage();
  }

  // Liste intégrable (iframe) d'une commune. nginx lève l'interdiction d'iframe
  // UNIQUEMENT sur /embed/ (voir deploy/nginx.conf).
  @Get("embed/:dept/:slug")
  @Header("Content-Type", "text/html; charset=utf-8")
  async embed(@Param("dept") dept: string, @Param("slug") slug: string): Promise<string> {
    const html = await this.svc.embedCommune(dept, slug);
    if (!html) throw new NotFoundException("Commune introuvable");
    return html;
  }

  // Images de partage : /og/chiffres.png, /og/<dept>.png, /og/<dept>/<slug>.png
  @Get("og/:a")
  @Header("Content-Type", "image/png")
  @Header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
  async og1(@Param("a") a: string): Promise<StreamableFile> {
    return this.png(await this.svc.ogImage(a.replace(/\.png$/, "")));
  }

  @Get("og/:a/:b")
  @Header("Content-Type", "image/png")
  @Header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
  async og2(@Param("a") a: string, @Param("b") b: string): Promise<StreamableFile> {
    return this.png(await this.svc.ogImage(a, b.replace(/\.png$/, "")));
  }

  private png(buf: Buffer | null): StreamableFile {
    if (!buf) throw new NotFoundException("Image introuvable");
    return new StreamableFile(buf);
  }

  @Get(":dept")
  @Header("Content-Type", "text/html; charset=utf-8")
  async deptIndex(@Param("dept") dept: string): Promise<string> {
    const html = await this.svc.deptIndex(dept);
    if (!html) throw new NotFoundException("Département non couvert");
    return html;
  }

  // /<dept>/<slug> : si <slug> est un thème (associations-sportives…) -> page
  // catégorie×département ; sinon c'est une commune.
  @Get(":dept/:slug")
  @Header("Content-Type", "text/html; charset=utf-8")
  async commune(@Param("dept") dept: string, @Param("slug") slug: string): Promise<string> {
    if (this.svc.isCategorySlug(slug)) {
      const cat = await this.svc.deptCategoryPage(dept, slug);
      if (!cat) throw new NotFoundException("Thème non couvert pour ce département");
      return cat;
    }
    const html = await this.svc.communePage(dept, slug);
    if (!html) throw new NotFoundException("Commune introuvable");
    return html;
  }
}
