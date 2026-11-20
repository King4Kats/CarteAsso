/**
 * Description OpenAPI 3.1 de l'API publique (servie sur /openapi.json et /api/v1/openapi.json).
 * À tenir à jour avec api-v1.controller.ts et ouvert.service.ts (forme des réponses).
 */
import { CATEGORIES } from "@carteasso/shared";

export function openapi(base: string): object {
  const nullable = (type: string, description?: string) => ({ type: [type, "null"], ...(description ? { description } : {}) });
  const association = {
    type: "object",
    required: ["id", "nom", "categorie", "url"],
    properties: {
      id: { type: "string", format: "uuid", description: "Identifiant CarteAsso." },
      nom: { type: "string" },
      categorie: { type: "string", description: "Domaine d'activité (libellé).", enum: CATEGORIES.map((c) => c.label).concat("Association") },
      commune: nullable("string"),
      code_postal: nullable("string"),
      departement: nullable("string", "Code du département (ex. 85, 2A, 974)."),
      distance_km: nullable("number", "Distance au lieu demandé, en km (null sans lieu)."),
      description: nullable("string", "Présentation, ou à défaut objet officiel déclaré au RNA (600 caractères au plus)."),
      site_web: nullable("string", "Site internet vérifié par CarteAsso."),
      facebook: nullable("string"),
      instagram: nullable("string"),
      helloasso: nullable("string"),
      email: nullable("string"),
      telephone: nullable("string"),
      numero_rna: nullable("string", "Numéro au Répertoire National des Associations (W…)."),
      url: { type: "string", format: "uri", description: "Fiche de l'association sur CarteAsso (à citer)." },
    },
  };
  const parametre = (name: string, description: string, example?: string, schema: object = { type: "string" }) =>
    ({ name, in: "query", required: false, description, schema, ...(example ? { example } : {}) });

  return {
    openapi: "3.1.0",
    info: {
      title: "API CarteAsso — associations de France",
      version: "1.0.0",
      description:
        "Recherche des associations actives en France (métropole et outre-mer) par activité et par lieu, " +
        "d'après le Répertoire National des Associations, enrichi par CarteAsso (domaine d'activité, site " +
        "internet et réseaux sociaux vérifiés). Lecture seule, sans clé, CORS ouvert. Limite : 40 requêtes " +
        "par minute et par adresse IP. Données sous Licence Ouverte 2.0 : citer « CarteAsso — " +
        new URL(base).host + " ».",
      contact: { name: "CarteAsso", url: `${base}/developpeurs` },
      license: { name: "Licence Ouverte 2.0 (données)", url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/" },
    },
    externalDocs: { description: "Documentation et exemples", url: `${base}/developpeurs` },
    servers: [{ url: `${base}/api/v1` }],
    paths: {
      "/recherche": {
        get: {
          operationId: "rechercherAssociations",
          summary: "Rechercher des associations par activité et par lieu",
          description:
            "Mots-clés tolérants aux fautes et aux synonymes (foot ↔ football). Avec un lieu, les " +
            "associations sont classées de la plus proche à la plus éloignée. Une phrase entière est " +
            "acceptée dans q (« club de voile à Vannes ») : le lieu en est extrait. Au moins un paramètre " +
            "parmi q, lieu, categorie et departement est nécessaire.",
          parameters: [
            parametre("q", "Mots-clés (activité, nom…), ou une phrase.", "judo"),
            parametre("lieu", "Commune ou code postal.", "Challans"),
            parametre("categorie", "Domaine d'activité.", "sport", { type: "string", enum: CATEGORIES.map((c) => c.id) }),
            parametre("departement", "Code du département.", "85"),
            parametre("limite", "Nombre de résultats (1 à 50, 10 par défaut).", "10", { type: "integer", minimum: 1, maximum: 50, default: 10 }),
          ],
          responses: {
            "200": {
              description: "Résultats",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      requete: { type: "object", description: "Paramètres compris." },
                      lieu_trouve: {
                        type: ["object", "null"],
                        properties: {
                          nom: { type: "string" }, codePostal: nullable("string"), departement: nullable("string"),
                          lng: { type: "number" }, lat: { type: "number" },
                        },
                      },
                      nombre: { type: "integer" },
                      resultats: { type: "array", items: { $ref: "#/components/schemas/Association" } },
                      source: { type: "string", description: "Mention à reprendre pour citer la source." },
                      url: { type: "string", format: "uri", description: "La même recherche sur le site." },
                      remarque: { type: "string" },
                    },
                  },
                },
              },
            },
            "429": { description: "Trop de requêtes (plus de 40 par minute)." },
          },
        },
      },
      "/associations/{id}": {
        get: {
          operationId: "ficheAssociation",
          summary: "Fiche d'une association",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": {
              description: "Fiche",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/Association" },
                      { type: "object", properties: { page_commune: nullable("string", "Page des associations de sa commune.") } },
                    ],
                  },
                },
              },
            },
            "404": { description: "Association inconnue." },
          },
        },
      },
      "/categories": {
        get: {
          operationId: "listerCategories",
          summary: "Domaines d'activité",
          responses: {
            "200": {
              description: "Liste",
              content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { id: { type: "string" }, libelle: { type: "string" } } } } } },
            },
          },
        },
      },
    },
    components: { schemas: { Association: association } },
  };
}
