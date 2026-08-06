"use client";

import { signIn } from "next-auth/react";

export function OAuthButtons({ callbackUrl }: { callbackUrl?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl: callbackUrl ?? "/" })}
        className="border-app-line text-app-fg hover:border-app-fg flex items-center justify-center gap-2.5 rounded-full border px-4 py-2.5 text-sm font-semibold transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.61H1.27a12 12 0 0 0 0 10.78l4-3.11Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4 3.11C6.22 6.86 8.87 4.75 12 4.75Z"
          />
        </svg>
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => signIn("github", { callbackUrl: callbackUrl ?? "/" })}
        className="border-app-line text-app-fg hover:border-app-fg flex items-center justify-center gap-2.5 rounded-full border px-4 py-2.5 text-sm font-semibold transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 0C5.37 0 0 5.5 0 12.29c0 5.43 3.44 10.03 8.21 11.66.6.11.82-.27.82-.6 0-.29-.01-1.06-.02-2.08-3.34.75-4.04-1.64-4.04-1.64-.55-1.43-1.34-1.82-1.34-1.82-1.1-.77.08-.75.08-.75 1.21.09 1.85 1.27 1.85 1.27 1.08 1.9 2.83 1.35 3.52 1.03.11-.81.42-1.35.77-1.66-2.66-.31-5.47-1.37-5.47-6.08 0-1.34.46-2.44 1.22-3.3-.12-.31-.53-1.55.12-3.24 0 0 1-.33 3.3 1.26a11.2 11.2 0 0 1 6 0c2.28-1.59 3.29-1.26 3.29-1.26.65 1.69.24 2.93.12 3.24.76.86 1.22 1.96 1.22 3.3 0 4.72-2.81 5.76-5.49 6.07.43.38.81 1.13.81 2.28 0 1.64-.02 2.97-.02 3.37 0 .33.21.72.83.6C20.57 22.31 24 17.71 24 12.29 24 5.5 18.63 0 12 0Z" />
        </svg>
        Continue with GitHub
      </button>
    </div>
  );
}
