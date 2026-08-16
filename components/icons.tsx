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

export function PhoneIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.6 2.2 7 5.1 5.6 6.6a8.2 8.2 0 0 0 4.8 4.8l1.5-1.4 2.9 1.4v2.4c0 .7-.6 1.3-1.3 1.2A12.8 12.8 0 0 1 2 3.5c-.1-.7.5-1.3 1.2-1.3h2.4Z" />
    </svg>
  );
}

export function MailIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.8" y="3.4" width="13.4" height="10.2" rx="1.6" />
      <path d="m2.4 4.5 6.1 4.3 6.1-4.3" />
    </svg>
  );
}
