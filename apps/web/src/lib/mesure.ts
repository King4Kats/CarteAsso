/**
 * Mesure d'audience Matomo côté app (le traceur est chargé par public/stats.js).
 * On pousse dans la file window._paq : si Matomo n'est pas encore chargé (ou bloqué
 * par un bloqueur de pub), les appels attendent ou sont ignorés, sans jamais gêner.
 */
type File = unknown[][];
const file = (): File => {
  const w = window as unknown as { _paq?: File };
  return (w._paq ??= []);
};

/** Un département ouvert sur la carte : rapport Matomo « Événements > Carte ». */
export function departementOuvert(nom: string, code: string): void {
  file().push(["trackEvent", "Carte", "Département ouvert", `${nom} (${code})`]);
}

/** Changement d'écran de l'app (carte, tri…) compté comme une page vue. */
export function ecranVu(ecran: string, titre: string): void {
  file().push(["setCustomUrl", `${location.origin}/#${ecran}`]);
  file().push(["setDocumentTitle", titre]);
  file().push(["trackPageView"]);
}
