/**
 * Point d'entrée de l'API NestJS (le tout premier fichier qui démarre le serveur).
 * Son rôle : créer l'application, la configurer (préfixe d'URL, CORS, arrêt propre)
 * puis la mettre à l'écoute des requêtes HTTP. C'est ce serveur que le front contacte via /api.
 */
import "reflect-metadata"; // requis par NestJS (lit les "décorateurs" @... pour câbler l'app)
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { getEnv } from "./config/env";

// Fonction de démarrage : on l'isole dans "bootstrap" car la création de l'app est asynchrone (attend des promesses).
async function bootstrap(): Promise<void> {
  const env = getEnv(); // lit et valide les variables d'environnement (port, origines autorisées...)
  // On crée l'app avec cors:false pour le configurer nous-mêmes juste après, de façon contrôlée.
  const app = await NestFactory.create(AppModule, { cors: false });

  // Toutes les routes seront préfixées par /api (ex: /api/associations). Les pages SEO
  // vivent sous /api/seo/... ; nginx réécrit les URL propres (/vendee/...) vers /api/seo.
  app.setGlobalPrefix("api");
  // CORS = autorise le front (autre adresse/port) à appeler l'API.
  // "*" => on autorise tout le monde ; sinon on découpe la liste d'origines séparées par des virgules.
  // L'API publique /api/v1 (lecture seule, documentée sur /developpeurs) est ouverte à tous
  // les sites ; le reste de l'API ne répond qu'aux origines de CORS_ORIGIN.
  const origines = env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",");
  app.enableCors((req: { url?: string }, cb: (err: Error | null, o: { origin: boolean | string[] }) => void) =>
    cb(null, { origin: req.url?.startsWith("/api/v1/") ? true : origines }));
  // Permet à Nest de bien fermer les connexions (base de données...) quand le serveur s'arrête.
  app.enableShutdownHooks();

  await app.listen(env.PORT); // démarre l'écoute des requêtes sur le port choisi
  new Logger("Bootstrap").log(`🎉 CarteAsso API → http://localhost:${env.PORT}/api`);
}

// On lance le démarrage. "void" indique qu'on ignore volontairement la promesse renvoyée.
void bootstrap();
