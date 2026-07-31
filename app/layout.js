import "./globals.css";
import { AmbientBackground } from "../components/ambient-background";
import { Header } from "../components/header";
import { Footer } from "../components/footer";

export const metadata = {
  title: "Shivam Patil — Software Engineer",
  description:
    "Portfolio of Shivam Patil, a software engineer building reliable distributed systems and AI products.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AmbientBackground />
        <div className="page-grid" aria-hidden="true" />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
