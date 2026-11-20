/**
 * Module "SEO" : regroupe le controller (pages /vendee, sitemap) et le service
 * qui génère le HTML. La base de données est fournie globalement (DbModule).
 */
import { Module } from "@nestjs/common";
import { SeoController } from "./seo.controller";
import { SeoService } from "./seo.service";
import { OuvertService } from "../ouvert/ouvert.service";
import { PagesOuvertes } from "../ouvert/ouvert.pages";
import { ApiV1Controller } from "../ouvert/api-v1.controller";

@Module({ controllers: [SeoController, ApiV1Controller], providers: [SeoService, OuvertService, PagesOuvertes] })
export class SeoModule {}
