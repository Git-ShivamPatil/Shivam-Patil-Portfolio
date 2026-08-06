export interface SkillCategory {
  label: string;
  items: string[];
}

export const skillCategories: SkillCategory[] = [
  { label: "Languages", items: ["C++", "Python", "Go", "Rust", "JavaScript", "TypeScript"] },
  { label: "Frontend", items: ["React.js", "Next.js"] },
  { label: "Backend", items: ["FastAPI", "REST APIs", "Microservices", "Distributed Systems"] },
  {
    label: "Cloud & DevOps",
    items: [
      "Azure Kubernetes Service (AKS)",
      "AWS",
      "Docker",
      "Kubernetes",
      "Prometheus",
      "Grafana",
    ],
  },
  {
    label: "AI/ML & Generative AI",
    items: [
      "AI Agents",
      "Prompt Engineering",
      "RAG (Retrieval-Augmented Generation)",
      "Vector Databases",
    ],
  },
  {
    label: "Core CS",
    items: ["System Programming", "MCP (Model Context Protocol)", "Multithreading", "Concurrency"],
  },
];
