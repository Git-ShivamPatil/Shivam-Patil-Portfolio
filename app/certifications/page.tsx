import type { Metadata } from "next";
import { certifications } from "../certifications";

export const metadata: Metadata = { title: "Certifications — Shivam Patil" };

export default function CertificationsPage() {
  return (
    <>
      <section className="page-hero shell">
        <p className="eyebrow">Certifications</p>
        <h1>
          Credentials that
          <br />
          <em>back it up.</em>
        </h1>
        <p>Formal recognition alongside the hands-on systems work.</p>
      </section>

      <div className="cert-grid shell">
        {certifications.map((cert) => (
          <div key={cert.name} className="cert-card">
            <span className="cert-year">{cert.year}</span>
            <h2>{cert.name}</h2>
            <p className="cert-issuer">{cert.issuer}</p>
            {cert.pending || !cert.credentialUrl ? (
              <span className="cert-pending">Verification link coming soon</span>
            ) : (
              <a
                href={cert.credentialUrl}
                target="_blank"
                rel="noreferrer"
                className="cert-verified"
              >
                Verify credential ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
