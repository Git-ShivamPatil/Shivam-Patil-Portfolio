import { pageMetadata } from "../../lib/seo/metadata";
import { ArrowUpRight } from "../../components/icons";
import { downloadHref } from "../../lib/analytics/downloads";
import { JsonLd } from "../../components/seo/json-ld";
import { breadcrumbJsonLd } from "../../lib/seo/structured-data";

export const metadata = pageMetadata({
  title: "Résumé",
  description:
    "The one-page résumé of Shivam Patil, Software Development Engineer: C++, Rust, Go, Python, distributed systems and AI. Read it here or download the PDF.",
  path: "/resume",
});

/**
 * The inline preview points at the file directly. It must NOT go through the
 * counted route: `<object>` fetches on every page load, which would count a
 * download for everyone who merely opened the page — and the one number this
 * phase has to get right is how many people actually took the PDF.
 */
const RESUME_FILE = "/Shivam-Patil-SDE-II-Resume.pdf";
/** Deliberate actions go through /d/resume, which counts them server-side. */
const RESUME_DOWNLOAD = downloadHref("resume");

export default function ResumePage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Résumé", href: "/resume" }])} />
      <section className="page-hero shell">
        <p className="eyebrow">Résumé</p>
        <h1>
          The full picture,
          <br />
          <em>one page.</em>
        </h1>
        <p>
          Software Development Engineer — <strong>C++, Rust, Go, Python</strong>, distributed
          systems and applied AI, based in Mumbai. Read it below, or download the PDF.
        </p>
      </section>

      <div className="resume-page-embed shell">
        <div className="resume-frame-wrap">
          <object
            data={RESUME_FILE}
            type="application/pdf"
            className="resume-frame"
            aria-label="Shivam Patil résumé preview"
          >
            <p className="resume-fallback">
              Your browser can&apos;t preview this PDF inline — use the download link below instead.
            </p>
          </object>
        </div>
        <div className="resume-page-actions">
          {/* `download` still applies across the redirect — it is honoured as
              long as the final URL is same-origin, and the registry only ever
              resolves to a site-relative file. */}
          <a
            href={RESUME_DOWNLOAD}
            download
            className="button button-solid"
            data-analytics-id="resume-download"
            data-analytics-id-label="Résumé — download button"
          >
            Download résumé <ArrowUpRight />
          </a>
          <a
            href={RESUME_DOWNLOAD}
            target="_blank"
            rel="noreferrer"
            className="button button-text"
            data-analytics-id="resume-open-tab"
            data-analytics-id-label="Résumé — open in new tab"
          >
            Open in new tab <span>→</span>
          </a>
        </div>
      </div>
    </>
  );
}
