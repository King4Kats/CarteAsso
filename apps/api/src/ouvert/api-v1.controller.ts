/**
 * API publique CarteAsso, version 1 : lecture seule, sans clé, ouverte à tous (CORS « * »,
 * voir main.ts). Déclarée sur data.gouv.fr à côté du Répertoire National des Associations.
 *
 *   GET /api/v1/recherche?q=judo&lieu=Challans   -> associations, les plus proches d'abord
 *   GET /api/v1/associations/<id>                -> fiche d'une association
 *   GET /api/v1/categories                       -> domaines d'activité
 *   GET /api/v1/openapi.json  (aussi /openapi.json) -> description OpenAPI 3.1
 *
 * Même moteur que la page /recherche (OuvertService). Anti-rafale : 40 requêtes/minute/IP.
 */
import { Controller, Get, Header, NotFoundException, Param, Query, UseGuards } from "@nestjs/common";
import { CATEGORIES } from "@carteasso/shared";
import { RechercheRateLimitGuard } from "../common/recherche-rate-limit.guard";
import { BASE, HOST } from "../seo/seo.service";
import { OuvertService, type ResultatRecherche } from "./ouvert.service";
import { openapi } from "./openapi";

const court = (v?: string, n = 100) => (typeof v === "string" ? v.slice(0, n) : undefined);

@Controller("v1")
export class ApiV1Controller {
  constructor(private readonly ouvert: OuvertService) {}

  @Get("recherche")
  @UseGuards(RechercheRateLimitGuard)
  @Header("Cache-Control", "public, max-age=600")
  recherche(
    @Query("q") q?: string, @Query("lieu") lieu?: string,
    @Query("categorie") categorie?: string, @Query("departement") departement?: string,
    @Query("limite") limite?: string,
  ): Promise<ResultatRecherche> {
    let p = { q: court(q), lieu: court(lieu), categorie: court(categorie, 30), departement: court(departement, 3) };
    // Une phrase entière dans q (« club de voile à Vannes ») : on en tire le lieu.
    if (p.q?.trim() && !p.lieu?.trim()) {
      const d = this.ouvert.decouper(p.q);
      if (d.lieu) p = { ...p, q: d.q ?? undefined, lieu: d.lieu };
    }
    return this.ouvert.rechercher({ ...p, limite: Number(limite) || 10 });
  }

  @Get("associations/:id")
  @UseGuards(RechercheRateLimitGuard)
  @Header("Cache-Control", "public, max-age=3600")
  async association(@Param("id") id: string) {
    const a = await this.ouvert.fiche(id);
    if (!a) throw new NotFoundException("Association introuvable (identifiant inconnu ou fiche non publiée).");
    return { ...a, source: `CarteAsso — ${HOST} (d'après le Répertoire National des Associations)` };
  }

  @Get("categories")
  @Header("Cache-Control", "public, max-age=86400")
  categories() {
    return CATEGORIES.map((c) => ({ id: c.id, libelle: c.label }));
  }

  @Get("openapi.json")
  @Header("Cache-Control", "public, max-age=3600")
  description() {
    return openapi(BASE);
  }
}
