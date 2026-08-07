"use client";

import { useState } from "react";
import Image from "next/image";

// Expects a real photo at public/profile.jpg. If it's missing (e.g. it
// hasn't been added yet), this falls back to the site's existing wordmark
// treatment scaled up, instead of showing a broken-image icon.
export function AboutPhoto() {
  const [failed, setFailed] = useState(false);

  return (
    <div className="about-photo-frame">
      {!failed ? (
        <Image
          src="/profile.jpg"
          alt="Shivam Patil"
          fill
          priority
          sizes="(max-width: 900px) 100vw, 40vw"
          className="about-photo-img"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="about-photo-fallback" aria-hidden="true">
          SP
        </div>
      )}
    </div>
  );
}
