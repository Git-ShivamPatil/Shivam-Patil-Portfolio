import type { Metadata } from "next";
import { ArrowUpRight } from "../../components/icons";

export const metadata: Metadata = { title: "Résumé — Shivam Patil" };

const RESUME_PATH = "/Shivam-Patil-SDE-II-Resume.pdf";

export default function ResumePage() {
  return (
    <>
      <section className="page-hero shell">
        <p className="eyebrow">Résumé</p>
        <h1>
          The full picture,
          <br />
          <em>one page.</em>
        </h1>
        <p>Preview it below, or download the latest PDF directly.</p>
      </section>

      <div className="resume-page-embed shell">
        <div className="resume-frame-wrap">
          <object
            data={RESUME_PATH}
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
          <a href={RESUME_PATH} download className="button button-solid">
            Download résumé <ArrowUpRight />
          </a>
          <a href={RESUME_PATH} target="_blank" rel="noreferrer" className="button button-text">
            Open in new tab <span>→</span>
          </a>
        </div>
      </div>
    </>
  );
}
