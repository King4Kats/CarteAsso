/*
 * Mesure d'audience CarteAsso : Matomo auto-hébergé (stats.flavienauvray.me, site n° 3).
 * Sans cookie et IP tronquée par Matomo -> pas de bandeau de consentement (dispense CNIL).
 * Fichier séparé (pas de script dans la page) : la CSP n'autorise aucun script en ligne.
 *
 * Chargé par l'app (index.html) ET par les pages générées par l'API (départements,
 * communes, fiches, recherche). Sur ces pages, on compte aussi la visite dans le suivi
 * maison (/api/stats/track, table `visits`, lu par les mails du matin et du soir), que
 * l'app alimente déjà de son côté.
 *
 * L'app ajoute ses propres événements via window._paq (voir apps/web/src/lib/mesure.ts).
 */
(function () {
  var _paq = (window._paq = window._paq || []);
  _paq.push(["disableCookies"]);
  // Droit d'opposition (condition de la dispense CNIL) : un navigateur réglé sur
  // « Ne pas me pister » n'est pas compté par Matomo. Annoncé dans /confidentialite.
  _paq.push(["setDoNotTrack", true]);
  _paq.push(["enableLinkTracking"]);
  _paq.push(["setTrackerUrl", "https://stats.flavienauvray.me/matomo.php"]);
  _paq.push(["setSiteId", "3"]);
  _paq.push(["trackPageView"]);
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://stats.flavienauvray.me/matomo.js";
  document.head.appendChild(s);

  // Page générée par l'API (pas l'app React) : visite comptée aussi dans le suivi maison.
  if (!document.getElementById("root")) {
    try {
      fetch("/api/stats/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "page", path: location.pathname }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {
      /* jamais bloquant */
    }
  }
})();
