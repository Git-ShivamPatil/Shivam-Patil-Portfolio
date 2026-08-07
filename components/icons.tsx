export function ArrowUpRight({ className = "" }: { className?: string }) {
  return (
    <span className={`arrow-icon ${className}`} aria-hidden="true">
      ↗
    </span>
  );
}

export function GridIcon() {
  return (
    <span className="grid-icon" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function PulseIcon() {
  return (
    <span className="pulse-icon" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function SearchIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="7.2" cy="7.2" r="5.4" />
      <line x1="11.2" y1="11.2" x2="15.5" y2="15.5" strokeLinecap="round" />
    </svg>
  );
}
