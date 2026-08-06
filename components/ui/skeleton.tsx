export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`bg-app-line/60 animate-pulse rounded-md ${className}`} />
  );
}
