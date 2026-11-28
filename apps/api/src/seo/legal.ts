/**
 * Contenu des deux pages juridiques obligatoires :
 *   /mentions-legales  -> qui édite et héberge le site (loi LCEN, art. 6)
 *   /confidentialite   -> quelles données personnelles passent par le site (RGPD, art. 13)
 *
 * Ces fonctions ne renvoient que le CORPS de la page (du HTML) ; SeoService.doc()
 * ajoute l'en-tête, le style et le pied de page communs à toutes les pages serveur.
 *
 * L'identité de l'éditeur ne figure PAS dans le code (le dépôt est public et peut être
 * réutilisé) : elle vient du fichier .env du serveur (EDITEUR_NOM, EDITEUR_SIRET,
 * CONTACT_EMAIL). Si une variable est vide, la ligne correspondante n'est pas affichée.
 *
 * ⚠️ Ces textes décrivent ce que fait VRAIMENT le site. Si on ajoute un service tiers
 * (police, carte, statistiques, envoi de mail…), il faut le déclarer ici aussi.
 */
import { esc } from "./seo.service";

export const LEGAL_MAJ = "28 novembre 2026";

export type Editeur = { nom: string; siret: string; email: string };

// Lien mailto lisible ; rien si l'adresse n'est pas configurée.
const mail = (email: string): string =>
  email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : "le formulaire de la page d'accueil";

export function mentionsBody(e: Editeur, host: string): string {
  return `
<h1>Mentions légales</h1>
<p class="lead">Mises à jour le ${LEGAL_MAJ}.</p>

<h2>Éditeur du site</h2>
<p>Le site <strong>${esc(host)}</strong> (CarteAsso) est édité par <strong>${esc(e.nom || "son auteur")}</strong>${e.siret ? `, entrepreneur individuel, SIRET ${esc(e.siret)}` : ""}. CarteAsso est un projet bénévole et gratuit : aucune publicité, aucune vente de données.</p>
<p>Contact : ${mail(e.email)}.<br>Directeur de la publication : ${esc(e.nom || "l'éditeur")}.</p>

<h2>Hébergement</h2>
<p>Le site est hébergé par l'éditeur lui-même, sur un serveur situé en France.</p>
<p>Il est acheminé et protégé par <strong>Cloudflare, Inc.</strong>, 101 Townsend Street, San Francisco, CA 94107, États-Unis (<a href="https://www.cloudflare.com/" rel="nofollow">cloudflare.com</a>).</p>
<p>La mesure d'audience est hébergée chez <strong>Infomaniak Network SA</strong>, rue Eugène-Marziano 25, 1227 Les Acacias (Genève), Suisse (<a href="https://www.infomaniak.com/" rel="nofollow">infomaniak.com</a>).</p>

<h2>Les informations publiées</h2>
<p>Les fiches proviennent du <strong>Répertoire National des Associations</strong> (RNA), publié par le ministère de l'Intérieur sur <a href="https://www.data.gouv.fr/" rel="nofollow">data.gouv.fr</a> sous Licence Ouverte 2.0. Les sites web et réseaux sociaux sont recherchés automatiquement sur des pages publiques : ils peuvent contenir des erreurs.</p>
<p>Votre association apparaît et vous voulez corriger ou retirer sa fiche ? Utilisez le lien « Déférencer une association » en bas de la <a href="/">page d'accueil</a>, ou écrivez à ${mail(e.email)}. Une fiche retirée n'est pas réintégrée lors des mises à jour suivantes.</p>

<h2>Propriété intellectuelle et licences</h2>
<ul>
<li>Données des associations (RNA et enrichissements CarteAsso) : <a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence/" rel="license">Licence Ouverte 2.0</a>, réutilisation libre avec mention « CarteAsso — ${esc(host)} ».</li>
<li>Fond de carte : © les contributeurs d'<a href="https://www.openstreetmap.org/copyright" rel="license">OpenStreetMap</a> (ODbL).</li>
<li>Code source : <a href="https://github.com/King4Kats/CarteAsso/blob/main/LICENSE" rel="license">PolyForm Noncommercial</a>.</li>
<li>Le nom et le logo CarteAsso appartiennent à l'éditeur.</li>
</ul>

<h2>Données personnelles et cookies</h2>
<p>Le site ne dépose <strong>aucun cookie</strong>. Ce qui concerne vos données est expliqué dans la <a href="/confidentialite">politique de confidentialité</a>.</p>`;
}

export function confidentialiteBody(e: Editeur): string {
  return `
<h1>Politique de confidentialité</h1>
<p class="lead">Mise à jour le ${LEGAL_MAJ}. En bref : <strong>pas de compte, pas de cookie, pas de publicité</strong>, et je ne vends ni ne partage aucune donnée.</p>

<h2>Qui est responsable</h2>
<p>${esc(e.nom || "L'éditeur du site")}, qui édite CarteAsso (voir les <a href="/mentions-legales">mentions légales</a>). Pour toute question sur vos données : ${mail(e.email)}.</p>

<h2>Quand vous visitez le site</h2>
<h3>Mesure d'audience</h3>
<p>J'utilise <strong>Matomo</strong>, installé sur mon propre serveur (hébergé en Suisse), <strong>sans cookie</strong> et avec une <strong>adresse IP tronquée</strong> (les deux derniers nombres sont effacés avant tout enregistrement). Je vois ainsi les pages consultées, le site ou le moteur de recherche d'où vous venez, une ville approximative, le type d'appareil et les mots tapés dans la recherche du site. Ces statistiques sont conservées 25 mois au plus et ne servent qu'à améliorer le site. Configurée ainsi, la mesure d'audience est dispensée de consentement (recommandations de la CNIL). Pour ne pas être compté, activez l'option « Ne pas me pister » (Do Not Track) de votre navigateur : Matomo la respecte.</p>
<p>Le site tient aussi son propre compteur de pages vues : il ne garde pas votre adresse IP, seulement une empreinte calculée à partir de l'adresse, du navigateur et de la date, qui change chaque jour.</p>
<h3>Journaux techniques</h3>
<p>Comme tout serveur web, le mien note chaque requête (adresse IP, page demandée, date, navigateur). Ces journaux servent à la sécurité et à repérer les abus. Ils s'effacent automatiquement au bout de quelques semaines au plus. Pour limiter les abus, l'adresse IP est aussi gardée en mémoire quelques minutes, puis oubliée.</p>
<h3>Services tiers chargés par votre navigateur</h3>
<ul>
<li><strong>Cloudflare</strong> (États-Unis) achemine toutes les pages du site et voit donc passer votre adresse IP.</li>
<li><strong>OpenStreetMap</strong> (OpenStreetMap Foundation, Royaume-Uni) fournit les images du fond de carte, avec la même conséquence.</li>
</ul>
<h3>Recherche par lieu</h3>
<p>Quand vous cherchez une commune ou une adresse, c'est le serveur de CarteAsso qui interroge la <a href="https://adresse.data.gouv.fr/" rel="nofollow">Base Adresse Nationale</a> (service public français) : elle reçoit le lieu tapé, jamais votre adresse IP.</p>

<h2>Quand vous remplissez un formulaire</h2>
<p>Les formulaires « Référencer mon asso » et « Déférencer une association » m'envoient un e-mail avec ce que vous avez saisi (nom de l'association, ville, message, e-mail de contact…). Rien n'est enregistré dans la base du site. Les e-mails passent par le service d'envoi <strong>Resend</strong> (Resend, Inc., États-Unis) et arrivent dans ma messagerie (Proton, Suisse). Je les garde le temps de traiter la demande et d'en garder la trace, trois ans au plus.</p>

<h2>Les informations sur les associations</h2>
<p>Les fiches reprennent des données publiques du Répertoire National des Associations, publiées en données ouvertes par l'État. Certaines peuvent être personnelles, par exemple quand l'adresse du siège est un domicile. Je les publie au titre de l'intérêt légitime : faire connaître les associations et faciliter la réutilisation de données publiques ouvertes.</p>
<p>Vous pouvez vous y opposer à tout moment, sans avoir à vous justifier : la fiche est alors retirée et exclue des mises à jour suivantes (lien « Déférencer une association » sur la <a href="/">page d'accueil</a>, ou ${mail(e.email)}).</p>

<h2>Transferts hors de l'Union européenne</h2>
<p>Cloudflare et Resend sont établis aux États-Unis et adhèrent au cadre de protection des données UE–États-Unis (Data Privacy Framework). Infomaniak et Proton sont en Suisse, et OpenStreetMap au Royaume-Uni : la Commission européenne reconnaît à ces deux pays un niveau de protection adéquat.</p>

<h2>Vos droits</h2>
<p>Vous pouvez demander l'accès à vos données, leur rectification ou leur effacement, vous opposer à leur utilisation ou en demander la limitation : écrivez à ${mail(e.email)}. Je réponds dans un délai d'un mois au plus. Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la <a href="https://www.cnil.fr/fr/plaintes" rel="nofollow">CNIL</a>.</p>`;
}
