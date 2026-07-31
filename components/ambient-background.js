const BACKGROUND_VIDEO =
  "/ambient-circuit.mp4";

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
