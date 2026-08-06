export interface Achievement {
  metric: string;
  label: string;
  source: string;
}

// Every entry below is a real, already-published metric from app/projects.ts
// or app/experience.ts — this page reframes existing quantified outcomes
// rather than introducing new claims.
export const achievements: Achievement[] = [
  {
    metric: "45K req/s",
    label: "sustained throughput at sub-8ms p99 latency",
    source: "Distributed Rate Limiter & API Gateway",
  },
  {
    metric: "87%",
    label: "agent task success across 150 evaluation cases",
    source: "Agentic AI Orchestration Platform",
  },
  {
    metric: "+230%",
    label: "inference throughput gain from continuous batching",
    source: "High-Performance LLM Inference Server",
  },
  {
    metric: "−42%",
    label: "p99 latency cut versus naive single-request serving",
    source: "High-Performance LLM Inference Server",
  },
  {
    metric: "13+",
    label: "production REST APIs shipped, cutting response latency 33%",
    source: "Tata Consultancy Services",
  },
  {
    metric: "+29%",
    label: "application performance gain from query & pipeline optimization",
    source: "Tata Consultancy Services",
  },
  {
    metric: "+19%",
    label: "RAG answer-accuracy improvement for a production chatbot",
    source: "Tata Consultancy Services",
  },
];
