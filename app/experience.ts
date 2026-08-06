export interface ExperienceEntry {
  role: string;
  org: string;
  period: string;
  location: string;
  highlights: string[];
}

export interface EducationEntry {
  degree: string;
  org: string;
  period: string;
  detail: string;
}

export const experience: ExperienceEntry[] = [
  {
    role: "Software Development Engineer (SDE)",
    org: "Tata Consultancy Services",
    period: "Jan 2025 — Present",
    location: "India",
    highlights: [
      "Designed and developed 13+ REST APIs powering a high-traffic production system serving 10,000+ requests/day, reducing response latency by 33% through performance optimization.",
      "Optimized SQL queries and data processing pipelines, improving application performance by 29% and ensuring reliability at scale.",
      "Enhanced retrieval-augmented generation (RAG) quality for a production RBI chatbot — tuning vector search relevance and building automated evaluation frameworks that improved answer accuracy by 19%.",
      "Collaborated with peer engineers through code reviews, upholding best practices for code quality, testability, and maintainability across the codebase.",
      "Implemented authentication and authorization using secure access-control frameworks aligned with enterprise security standards.",
    ],
  },
];

export const education: EducationEntry[] = [
  {
    degree: "Bachelor of Technology, Artificial Intelligence and Data Science",
    org: "Pune University",
    period: "July 2020 — June 2024",
    detail: "GPA: 8.88 / 10",
  },
];
