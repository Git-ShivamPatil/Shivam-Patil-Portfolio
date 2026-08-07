import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px",
        background: "#111110",
        color: "#f4f3ee",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "84px",
          height: "84px",
          borderRadius: "50%",
          background: "#d8fe67",
          color: "#111110",
          fontSize: "28px",
          fontWeight: 700,
          letterSpacing: "-2px",
        }}
      >
        SP
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <div style={{ fontSize: "64px", fontWeight: 700, letterSpacing: "-2px", lineHeight: 1.05 }}>
          Shivam Patil
        </div>
        <div style={{ fontSize: "30px", color: "#c6c5bd" }}>
          Software engineer — distributed systems &amp; AI products
        </div>
      </div>
    </div>,
    { ...size },
  );
}
