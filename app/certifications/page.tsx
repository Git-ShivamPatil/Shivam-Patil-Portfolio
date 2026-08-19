import { pageMetadata } from "../../lib/seo/metadata";
import { certifications } from "../certifications";
import { JsonLd } from "../../components/seo/json-ld";
import { breadcrumbJsonLd, credentialsJsonLd } from "../../lib/seo/structured-data";

export const metadata = pageMetadata({
  title: "Certifications",
  description:
    "Courses and exams completed by Shivam Patil, each with a link you can use to verify it independently rather than take on trust.",
  path: "/certifications",
});

export default function CertificationsPage() {
  const achieved = certifications
    .filter((certification) => !certification.pending)
    .map((certification) => ({
      name: certification.name,
      issuer: certification.issuer,
      year: certification.year,
      credentialUrl: certification.credentialUrl ?? undefined,
    }));

  return (
    <>
      {/* `pending` certificates are excluded, and today that means the
          credential block is not emitted at all — every entry in
          app/certifications.ts is still `pending: true`.

          That is the correct output, not a gap to work around. Marking up an
          unearned credential is precisely the shape of claim that earns a
          structured-data manual action, and the page itself already renders
          these as "coming soon" rather than as achieved; markup that disagreed
          with the visible page would be the worse half of the contradiction.

          The block appears on its own the day a certificate is awarded and its
          `pending` flag flips — no code change needed. An empty ItemList is
          skipped rather than emitted with `numberOfItems: 0`, because a list
          declaring it has nothing in it tells a crawler nothing it did not
          already know from the absence. */}
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Certifications", href: "/certifications" }]),
          ...(achieved.length > 0 ? [credentialsJsonLd(achieved)] : []),
        ]}
      />
      <section className="page-hero shell">
        <p className="eyebrow">Certifications</p>
        <h1>
          Credentials that
          <br />
          <em>back it up.</em>
        </h1>
        <p>
          Courses and exams in software engineering, cloud infrastructure and AI — each one with a
          link you can follow to verify it yourself rather than take on trust.
        </p>
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
