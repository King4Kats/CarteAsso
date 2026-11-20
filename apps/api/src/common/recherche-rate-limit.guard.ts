/**
 * Anti-rafale de la page /recherche : chaque recherche interroge le moteur, la Base
 * Adresse Nationale et la base. 40 recherches par minute et par adresse IP suffisent
 * largement à une personne ou à un assistant IA ; au-delà, un robot aspire le site.
 */
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { clientIp } from "./client-ip";

const FENETRE_MS = 60_000;
const MAX = 40;
const passages = new Map<string, number[]>();

@Injectable()
export class RechercheRateLimitGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const ip = clientIp(ctx.switchToHttp().getRequest());
    const maintenant = Date.now();
    const recents = (passages.get(ip) ?? []).filter((t) => maintenant - t < FENETRE_MS);
    if (recents.length >= MAX) {
      throw new HttpException("Trop de recherches, réessayez dans une minute.", HttpStatus.TOO_MANY_REQUESTS);
    }
    recents.push(maintenant);
    passages.set(ip, recents);
    if (passages.size > 10_000) passages.clear();
    return true;
  }
}
