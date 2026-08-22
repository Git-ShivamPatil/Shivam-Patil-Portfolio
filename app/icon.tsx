import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        // --ink and --paper. The favicon is 32px of solid colour and the
        // first thing a tab shows, so it carries the site's highest-contrast
        // pairing rather than an accent that no longer exists.
        background: "#0e0e0e",
        color: "#ffffff",
        fontSize: "14px",
        fontWeight: 600,
        letterSpacing: "-1px",
      }}
    >
      SP
    </div>,
    { ...size },
  );
}
