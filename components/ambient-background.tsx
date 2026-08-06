// Ported from the version already live on the deployed site (found on
// origin/main, which this local checkout had never had a copy of) — kept
// as its own component rather than folded into layout.tsx, matching how
// it was already factored.
const BACKGROUND_VIDEO = "/ambient-circuit.mp4";

export function AmbientBackground() {
  return (
    <div className="ambient-background" aria-hidden="true">
      <video autoPlay loop muted playsInline preload="auto">
        <source src={BACKGROUND_VIDEO} type="video/mp4" />
      </video>
      <div className="ambient-background-tint" />
    </div>
  );
}
