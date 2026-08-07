export interface Certification {
  name: string;
  issuer: string;
  year: string;
  credentialUrl: string | null;
  pending: boolean;
}

// Credential verification links are placeholders in the source résumé itself
// ("[Link]") — rendered as a "coming soon" state rather than a fabricated URL.
export const certifications: Certification[] = [
  {
    name: "Microsoft Certified: Azure Data Scientist Associate",
    issuer: "Microsoft",
    year: "2026",
    credentialUrl: null,
    pending: true,
  },
  {
    name: "AWS Certified Developer – Associate",
    issuer: "Amazon Web Services",
    year: "2026",
    credentialUrl: null,
    pending: true,
  },
];
