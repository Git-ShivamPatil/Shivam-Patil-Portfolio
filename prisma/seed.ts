// One-time data migration from the pre-CMS static content files into the
// database (Phase 3). Safe to re-run — every upsert is keyed by slug/
// category+name, so it converges rather than duplicating rows.
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient, type ProjectAccent } from "../lib/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// Transcribed verbatim from the original app/skills.ts static array (that
// file is now a DB-backed data module, same as app/projects.ts).
/**
 * Two entries are deliberately absent, and both were removed rather than never
 * added — see scripts/prune-unevidenced-skills.mts for the full reasoning:
 *
 * - **AWS.** The Developer Associate certification is real and lives on
 *   /certifications. Every deployment actually performed is Azure/AKS, so
 *   listing AWS here read as hands-on cloud experience it is not.
 * - **MCP (Model Context Protocol).** A grep of the whole repository found it
 *   in this array and nowhere else. No project, no bullet, no implementation.
 *
 * The rule both fail is the one /skills is now built around: every skill token
 * has to trace to something checkable. Do not re-add either without an artifact
 * behind it.
 */
const skillCategories: { label: string; items: string[] }[] = [
  { label: "Languages", items: ["C++", "Python", "Go", "Rust", "JavaScript", "TypeScript"] },
  { label: "Frontend", items: ["React.js", "Next.js"] },
  { label: "Backend", items: ["FastAPI", "REST APIs", "Microservices", "Distributed Systems"] },
  {
    label: "Cloud & DevOps",
    items: ["Azure Kubernetes Service (AKS)", "Docker", "Kubernetes", "Prometheus", "Grafana"],
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
    items: ["System Programming", "Multithreading", "Concurrency"],
  },
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

interface StaticProject {
  slug: string;
  number: string;
  category: string;
  title: string;
  shortTitle: string;
  summary: string;
  outcome: string;
  accent: ProjectAccent;
  stack: string[];
  useCase: string;
  implemented: [string, string][];
  architecture: { title: string; detail: string; type: "input" | "core" | "store" | "output" }[];
  steps: [string, string, string][];
}

// Originally transcribed verbatim from the old app/projects.ts static array.
//
// The `summary`, `useCase` and three `outcome` strings have since been
// rewritten; everything else — `implemented`, `architecture`, `steps`, `stack`
// — is untouched, because those were already the dense part.
//
// What was wrong with the copy: each summary opened by naming its own genre
// ("A fault-tolerant gateway that...", "A governed, multi-agent runtime
// that...", "An enterprise knowledge assistant that..."), then described the
// system in adjectives. A reader who already knows what a gateway is learns
// nothing from being told this one is fault-tolerant; what they want is which
// algorithms, which failure model, which store. The rewrites name mechanisms,
// and every mechanism named below already appears in that project's own
// `implemented` or `stack` array further down — nothing new is claimed here.
//
// Three `outcome` values were adjectives where the other three were numbers:
// "Secure by design", "Secure · concurrent · resilient", "Grounded &
// governed". Those render in the same chip as "45K req/s · <8ms p99", which
// invites the reader to weigh them the same way. They now name the stack
// decision that earns the claim instead of asserting the claim.
//
// NOTE: editing these strings does NOT change the live site, and it is worth
// being explicit about why, because the obvious assumption is wrong.
//
// The project upsert below is `update: {}`. That is deliberate — once a row
// exists, /admin/projects is its source of truth, and a seed that overwrote on
// every run would silently discard anything edited through the UI. The
// consequence is that this file only ever INSERTS. On a database that already
// holds these six slugs, `pnpm db:seed` is a no-op for them.
//
// So the copy here is what a FRESH database gets. Pushing it to rows that
// already exist is a separate, explicit step:
//
//     pnpm tsx scripts/backfill-project-copy.mts            # dry run
//     pnpm tsx scripts/backfill-project-copy.mts --apply
//
// Keep the two files in sync when either changes.
const staticProjects: StaticProject[] = [
  {
    slug: "distributed-rate-limiter-api-gateway",
    number: "01",
    category: "Distributed systems",
    title: "Distributed Rate Limiter & API Gateway",
    shortTitle: "Rate limiter",
    summary:
      "Multi-tenant API gateway: token-bucket and sliding-window quotas across a consistent-hash shard ring, with Raft election covering shard failure.",
    outcome: "45K req/s · <8ms p99",
    accent: "cyan",
    stack: ["Go", "gRPC / REST", "Redis", "PostgreSQL", "AKS", "Prometheus", "React"],
    useCase:
      "Keep per-tenant quotas accurate across replicas and regions while a noisy neighbour, a lost shard or a region blip is in progress.",
    implemented: [
      [
        "Dual limiting strategies",
        "Token-bucket for smooth burst control and sliding-window counters for stricter endpoint policies.",
      ],
      [
        "Resilient control plane",
        "Consistent-hash sharding keeps a tenant on a stable limiter shard; Raft election promotes a replacement leader on failure.",
      ],
      [
        "Observable delivery",
        "gRPC and REST APIs expose decisions and quota status, while Prometheus metrics feed Grafana and a live React dashboard.",
      ],
    ],
    architecture: [
      { title: "Client traffic", detail: "REST / gRPC", type: "input" },
      { title: "Gateway replicas", detail: "auth · routing · policy", type: "core" },
      { title: "Limiter shard ring", detail: "hashing · Raft", type: "core" },
      { title: "Redis + Postgres", detail: "counters · policies", type: "store" },
      { title: "Grafana + React", detail: "metrics · quotas", type: "output" },
    ],
    steps: [
      [
        "Bring up the data plane",
        "Start Redis and PostgreSQL locally; apply the tenant-policy schema before launching the gateway.",
        "docker compose up -d redis postgres\nmake migrate",
      ],
      [
        "Start a shard",
        "Run a gateway replica with the desired node identity and consistent-hash ring configuration.",
        "go run ./cmd/gateway --node gateway-1 --config ./configs/local.yaml",
      ],
      [
        "Attach the dashboard",
        "Install the dashboard dependencies and point it at the REST metrics endpoint.",
        "cd dashboard && npm install && npm run dev",
      ],
      [
        "Prove the envelope",
        "Exercise both a burst and sustained-load profile, then inspect p99 latency and rejected requests.",
        "k6 run tests/rate-limit.js\nkubectl get pods -n gateway",
      ],
    ],
  },
  {
    slug: "agentic-ai-orchestration-platform",
    number: "02",
    category: "AI systems",
    title: "Agentic AI Orchestration Platform",
    shortTitle: "Agentic platform",
    summary:
      "Multi-agent runtime on a plan-retrieve-act-critique loop, emitting a full decision and tool-call trace on every run.",
    outcome: "87% success · 150 eval cases",
    accent: "violet",
    stack: [
      "Python",
      "FastAPI",
      "Tool calling",
      "Pinecone / Weaviate",
      "PostgreSQL",
      "WebSockets",
      "React",
    ],
    useCase:
      "Make knowledge-work requests repeatable and auditable — the reasoning trace and tool activity stay visible rather than collapsing into an answer.",
    implemented: [
      [
        "Specialised agent loop",
        "Planner, retriever, executor, and critic agents share task state and take turns through explicit tool-calling contracts.",
      ],
      [
        "Safe recovery",
        "A sandboxed execution loop captures failed actions, lets the critic propose corrections, and bounds retries with policy checks.",
      ],
      [
        "Governance surface",
        "WebSocket events stream live traces to React; PostgreSQL persists inputs, tools, outputs, and checkpoints for replay.",
      ],
    ],
    architecture: [
      { title: "Operator", detail: "React workspace", type: "input" },
      { title: "FastAPI runtime", detail: "tasks · WebSockets", type: "core" },
      { title: "Agent team", detail: "plan · retrieve · act · critique", type: "core" },
      { title: "Knowledge + audit", detail: "Vector DB · Postgres", type: "store" },
      { title: "Evaluation harness", detail: "quality · replay", type: "output" },
    ],
    steps: [
      [
        "Configure model and storage",
        "Copy the example environment file and provide model, vector-store, and database credentials.",
        "cp .env.example .env\ndocker compose up -d postgres weaviate",
      ],
      [
        "Run the orchestration API",
        "Install Python dependencies, apply the schema, and start the FastAPI development server.",
        "uv sync\nuv run alembic upgrade head\nuv run fastapi dev app/main.py",
      ],
      [
        "Open the trace console",
        "Launch the React client and connect it to the WebSocket endpoint exposed by the API.",
        "cd web && npm install && npm run dev",
      ],
      [
        "Evaluate a task suite",
        "Run the Ragas-style harness against the pinned benchmark cases and compare success rate by agent stage.",
        "uv run python -m evals.run --suite core-150",
      ],
    ],
  },
  {
    slug: "high-performance-llm-inference-server",
    number: "03",
    category: "Systems engineering",
    title: "High-Performance LLM Inference Server",
    shortTitle: "LLM inference",
    summary:
      "Rust inference runtime built on continuous batching and explicit KV-cache management, with live throughput and tail-latency signals.",
    outcome: "+230% throughput · −42% p99",
    accent: "orange",
    stack: [
      "Rust",
      "Python / PyO3",
      "gRPC",
      "Continuous batching",
      "INT8 / FP16",
      "Docker",
      "React",
    ],
    useCase:
      "Serve concurrent LLM requests without the throughput collapse and p99 spikes that single-request inference hits under load.",
    implemented: [
      [
        "Continuous scheduler",
        "A Rust scheduler admits compatible requests at decode boundaries instead of waiting for a full batch to finish.",
      ],
      [
        "Memory-aware serving",
        "KV-cache slots are reserved, reused, and released predictably; model loading supports INT8 and FP16 variants.",
      ],
      [
        "Inspectable performance",
        "gRPC exposes generation controls, while React visualises token rate, batch fill, and memory pressure in real time.",
      ],
    ],
    architecture: [
      { title: "Apps + dashboard", detail: "gRPC · React", type: "input" },
      { title: "Inference gateway", detail: "routing · streaming", type: "core" },
      { title: "Rust scheduler", detail: "continuous batch", type: "core" },
      { title: "Model + KV cache", detail: "INT8 / FP16", type: "store" },
      { title: "Telemetry", detail: "tokens · memory · batches", type: "output" },
    ],
    steps: [
      [
        "Build the runtime",
        "Compile the Rust server with the CUDA or CPU feature set required by the target machine.",
        "cargo build --release --features cuda",
      ],
      [
        "Prepare a model",
        "Fetch a supported checkpoint and select the quantisation profile for the serving environment.",
        "./target/release/inference pull --model ./models/model.gguf --quant int8",
      ],
      [
        "Start the gRPC service",
        "Launch the scheduler with bounded batch and cache settings.",
        "./target/release/inference serve --port 50051 --max-batch 32",
      ],
      [
        "Watch and load test",
        "Open the dashboard, then drive concurrent streaming prompts through the gRPC benchmark client.",
        "cd dashboard && npm run dev\npython bench.py --concurrency 64",
      ],
    ],
  },
  {
    slug: "secure-banking-system",
    number: "04",
    category: "FinTech infrastructure",
    title: "Secure Banking System",
    shortTitle: "Secure banking",
    summary:
      "Banking platform on a Hyperledger Fabric ledger, with Kafka-decoupled transaction events and Vault-managed secrets behind OAuth2 Django APIs.",
    outcome: "Fabric ledger · Kafka · Vault",
    accent: "lime",
    stack: [
      "Python",
      "Django",
      "Hyperledger Fabric",
      "Web3.py",
      "Kafka",
      "Vault",
      "Kubernetes",
      "Grafana",
    ],
    useCase:
      "Process financial operations against a verifiable ledger, with asynchronous enrichment that survives a downstream outage.",
    implemented: [
      [
        "Ledger-backed transactions",
        "Hyperledger Fabric records authorised state changes while Django APIs coordinate application-level workflows.",
      ],
      [
        "Event-driven processing",
        "Kafka decouples high-volume transaction events from downstream enrichment and notification services.",
      ],
      [
        "Defense in depth",
        "OAuth2, Redis caching, Vault-managed secrets, container deployment, and Prometheus/Grafana support security and operations.",
      ],
    ],
    architecture: [
      { title: "Banking clients", detail: "web · mobile", type: "input" },
      { title: "Django API", detail: "OAuth2 · policy", type: "core" },
      { title: "Fabric network", detail: "endorsers · ledger", type: "core" },
      { title: "Kafka + Postgres", detail: "events · operations", type: "store" },
      { title: "Vault + Grafana", detail: "secrets · observability", type: "output" },
    ],
    steps: [
      [
        "Start foundational services",
        "Bring up the ledger network, database, broker, cache, and secret manager for local development.",
        "docker compose up -d postgres redis kafka vault\n./network.sh up createChannel",
      ],
      [
        "Deploy the chaincode",
        "Package and commit the banking transaction contract to the development channel.",
        "./network.sh deployCC -ccn banking -ccp ../chaincode -ccl go",
      ],
      [
        "Run the application API",
        "Configure the Fabric connection profile and apply the Django database migrations.",
        "python manage.py migrate\npython manage.py runserver",
      ],
      [
        "Deploy observability",
        "Install the monitoring stack and verify the transaction and consumer metrics dashboards.",
        "helm upgrade --install monitoring prometheus-community/kube-prometheus-stack",
      ],
    ],
  },
  {
    slug: "online-examination-system",
    number: "05",
    category: "Platform engineering",
    title: "Online Examination System",
    shortTitle: "Exam platform",
    summary:
      "Assessment platform: NGINX across FastAPI workers, Redis-held session and scoring state, JWT-scoped endpoints, server-side validation throughout.",
    outcome: "NGINX → FastAPI · Redis · JWT",
    accent: "blue",
    stack: ["Python", "FastAPI", "PostgreSQL", "Redis", "Docker", "NGINX", "AWS", "JWT"],
    useCase:
      "Hold a consistent assessment session when hundreds of candidates start, autosave and submit inside the same few seconds.",
    implemented: [
      [
        "Fast, balanced API layer",
        "NGINX routes requests across FastAPI workers and Redis keeps hot session and scoring state close to the application.",
      ],
      [
        "Secure exam sessions",
        "JWT-protected endpoints, encrypted data handling, access controls, and server-side validation protect candidate interactions.",
      ],
      [
        "Fault-tolerant scoring",
        "Submission events are safely persisted and a resilient scoring path uses caching to keep results responsive under load.",
      ],
    ],
    architecture: [
      { title: "Candidates", detail: "exam workspace", type: "input" },
      { title: "NGINX edge", detail: "TLS · load balancing", type: "core" },
      { title: "FastAPI workers", detail: "auth · answers · score", type: "core" },
      { title: "Redis + Postgres", detail: "sessions · durable data", type: "store" },
      { title: "Scoring worker", detail: "retries · outcomes", type: "output" },
    ],
    steps: [
      [
        "Configure the environment",
        "Set local secrets and start PostgreSQL plus Redis before booting the application.",
        "cp .env.example .env\ndocker compose up -d postgres redis",
      ],
      [
        "Apply the schema",
        "Create the required tables and seed a sample examination with questions and access policy.",
        "alembic upgrade head\npython scripts/seed_exam.py",
      ],
      [
        "Launch behind the proxy",
        "Start the API workers and the NGINX container that distributes incoming test traffic.",
        "docker compose up --build api nginx",
      ],
      [
        "Exercise concurrent sessions",
        "Run a mixed create, save, and submit traffic scenario to inspect response time and score consistency.",
        "k6 run tests/exam-journey.js",
      ],
    ],
  },
  {
    slug: "secure-rag-with-rbac-guardrails-monitoring",
    number: "06",
    category: "Generative AI",
    title: "Secure RAG with RBAC, Guardrails & Monitoring",
    shortTitle: "Secure RAG",
    summary:
      "Enterprise RAG with RBAC metadata pushed into the vector-search filter, PII masking before generation, and Ragas scoring on every change.",
    outcome: "RBAC-filtered retrieval · Ragas",
    accent: "pink",
    stack: ["Python", "Qdrant / Milvus", "Streamlit", "Ragas", "Docling", "AWS", "RBAC", "LLMs"],
    useCase:
      "Answer from private corpora while guaranteeing a caller can retrieve only what their role permits — enforced at the retrieval filter, not the prompt.",
    implemented: [
      [
        "Permission-aware retrieval",
        "RBAC metadata is applied to the retrieval filter so vector search respects the caller's organisational scope.",
      ],
      [
        "Ingestion and protection",
        "Docling prepares source documents; guardrails mask PII and detect out-of-scope or unsafe requests before generation.",
      ],
      [
        "Quality feedback loop",
        "Ragas-based monitoring evaluates retrieval relevance and response quality so regressions are visible and actionable.",
      ],
    ],
    architecture: [
      { title: "Knowledge user", detail: "Streamlit workspace", type: "input" },
      { title: "RBAC + guardrails", detail: "policy · PII checks", type: "core" },
      { title: "RAG service", detail: "retrieve · ground · answer", type: "core" },
      { title: "Vector knowledge", detail: "Docling · Qdrant / Milvus", type: "store" },
      { title: "Ragas monitor", detail: "quality signals", type: "output" },
    ],
    steps: [
      [
        "Start the knowledge services",
        "Run the vector store and database containers and configure the model provider in the environment file.",
        "docker compose up -d qdrant postgres\ncp .env.example .env",
      ],
      [
        "Ingest approved sources",
        "Parse documents into chunks, attach ACL metadata, then create or refresh vector embeddings.",
        "python -m app.ingest ./documents --collection knowledge-base",
      ],
      [
        "Launch the workspace",
        "Start the Streamlit interface and authenticate with a user role to verify scoped retrieval.",
        "streamlit run app/ui.py",
      ],
      [
        "Measure quality",
        "Run the evaluation suite and review relevance, faithfulness, and guardrail outcomes before releasing changes.",
        "python -m evals.ragas --dataset evals/golden.json",
      ],
    ],
  },
];

async function main() {
  console.log(`Seeding ${staticProjects.length} projects...`);
  for (const [index, project] of staticProjects.entries()) {
    await prisma.project.upsert({
      where: { slug: project.slug },
      update: {},
      create: { ...project, tags: project.stack, order: index },
    });
  }

  console.log(`Seeding skills from ${skillCategories.length} categories...`);
  // A single incrementing counter across all categories (not reset per
  // category) so that ordering by `order` alone — see getSkillCategories()
  // — reproduces the original file's category sequence, not an alphabetical
  // one, without needing a separate category-ordering concept.
  let order = 0;
  for (const category of skillCategories) {
    for (const name of category.items) {
      await prisma.skill.upsert({
        where: { category_name: { category: category.label, name } },
        update: { order },
        create: { category: category.label, name, order },
      });
      order++;
    }
  }

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
