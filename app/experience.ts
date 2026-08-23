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

/**
 * `**double asterisks**` mark the phrase worth catching in a scan — see
 * lib/emphasis.tsx. The markers stay in the data so the strings remain
 * strings: /experience renders them through `emphasise()`, and the AI
 * corpus strips them with `stripEmphasis()` so the index never sees them.
 *
 * Mark the claim, not the sentence. A bullet with half of it bold has no
 * emphasis at all — the eye needs the unmarked text to measure the marked
 * text against.
 */
export const experience: ExperienceEntry[] = [
  {
    role: "Software Development Engineer (SDE)",
    org: "Tata Consultancy Services",
    period: "Jan 2025 — Present",
    location: "India",
    // Verb, object, number. Every bullet below carries the same three
    // things and nothing else.
    //
    // The previous set averaged 168 characters and spent most of them on
    // scaffolding — "Designed and developed", "ensuring reliability at
    // scale", "upholding best practices for code quality, testability, and
    // maintainability across the codebase". None of that is a claim; it is
    // the connective tissue around a claim, and a recruiter scanning six
    // roles reads past it to find the number. Putting the number in the
    // sentence rather than at the end of it is the whole edit.
    //
    // No figure here is new. 13+, 10,000/day, 33%, 29% and 19% are the same
    // five numbers the bullets already carried; /achievements reads them
    // back from this file and would surface any drift.
    highlights: [
      "Shipped **13+ production REST APIs** behind a system serving 10,000+ requests/day. **Response latency down 33%.**",
      "Rewrote hot-path SQL and data-processing pipelines: **+29% application performance**.",
      "Raised **RAG answer accuracy 19%** on a production RBI chatbot — vector-search relevance tuning plus an automated evaluation harness.",
      "Built **authentication and role-based authorization** against enterprise access-control standards.",
      "Reviewed peer changes across the team's services, gating on **testability and maintainability**.",
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
