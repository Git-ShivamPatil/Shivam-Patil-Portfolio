import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Header } from "../components/header";
import { Footer } from "../components/footer";

export const metadata: Metadata = {
  title: "Shivam Patil — Software Engineer",
  description:
    "Portfolio of Shivam Patil, a software engineer building reliable distributed systems and AI products.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page-grid" aria-hidden="true" />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
