/**
 * Logo — le logo de CarteAsso (image), cliquable (sert en général à revenir à l'accueil).
 * C'est le wordmark officiel "CarteAsso" avec ses confettis (fichier public/logo.svg, vectoriel : net sur tous les écrans).
 * "size" pilote la HAUTEUR du logo ; la largeur s'ajuste automatiquement (ratio conservé).
 */
export function Logo({ size = 22, onClick }: { size?: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="CarteAsso — accueil"
      style={{
        display: "inline-flex", alignItems: "center",
        border: 0, background: "transparent", cursor: onClick ? "pointer" : "default", padding: 0,
      }}
    >
      <img
        src="/logo.svg"
        alt="CarteAsso"
        style={{ height: size + 8, width: "auto", display: "block" }}
      />
    </button>
  );
}
