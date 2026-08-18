/**
 * P25 — token accounting and what inference would cost.
 *
 * **The estimate is an estimate, and the file says so rather than implying
 * precision it does not have.** A real tokeniser is a model-specific BPE merge
 * table; `tiktoken` for OpenAI, SentencePiece for Llama, and they disagree with
 * each other on the same string. Shipping one to count tokens for a page that
 * displays a cost figure would be several megabytes of WASM for a number nobody
 * is billed on.
 *
 * So this uses the heuristic every provider publishes as a rule of thumb — a
 * character ratio, corrected for whitespace and punctuation.
 *
 * **There is no local ground truth to calibrate against, and an earlier version
 * of this comment claimed there was.** It asserted agreement "within roughly
 * 15%" of `countTokens` in lib/ai/corpus.ts. That comparison is meaningless:
 * `countTokens` counts tokenizer *words*, and BPE tokens are subword units, so
 * the two count different things and differ by about 2×. The test that was
 * supposed to prove the claim is what disproved it.
 *
 * What can be checked without a real tokeniser is the *relationship*: BPE
 * produces more tokens than words for English prose, by a factor between about
 * 1.2 and 2.5 depending on vocabulary. The tests assert that band and the
 * structural properties — code denser than prose, indentation not counted —
 * rather than a precision figure nothing here can support.
 *
 * Good enough for "will this prompt fit". Not good enough to bill anyone.
 * Anything that must be exact has to ask the provider, which returns the true
 * count in its response.
 */

/**
 * Average characters per token, English prose.
 *
 * ~4 is the figure OpenAI, Anthropic and Meta all publish for English. Code and
 * identifiers run denser — roughly 3 — because BPE splits on case changes and
 * punctuation, which is why the estimator below looks at what it is counting
 * instead of applying one constant to everything.
 */
const CHARS_PER_TOKEN_PROSE = 4;
const CHARS_PER_TOKEN_CODE = 3;

/** Fraction of non-alphanumeric characters above which text is treated as code. */
const CODE_DENSITY = 0.18;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;

  const symbols = (text.match(/[^A-Za-z0-9\s]/g) ?? []).length;
  const density = symbols / text.length;
  const ratio = density > CODE_DENSITY ? CHARS_PER_TOKEN_CODE : CHARS_PER_TOKEN_PROSE;

  // Whitespace runs collapse to nothing much in BPE, so counting raw length
  // overstates a heavily-indented block by a lot.
  const collapsed = text.replace(/\s+/g, " ").length;
  return Math.max(1, Math.ceil(collapsed / ratio));
}

export interface ModelCost {
  id: string;
  label: string;
  /** USD per million input tokens. */
  inputPerMillion: number;
  /** USD per million output tokens. */
  outputPerMillion: number;
  contextTokens: number;
  /** Where it runs. "device" models cost nothing per token and cost a download. */
  location: "device" | "hosted";
  /** Download size in megabytes, for on-device models. */
  downloadMb?: number;
  note: string;
}

/**
 * The comparison this site actually faces.
 *
 * Prices move; these are indicative and dated in the note rather than presented
 * as current. The interesting column is `location` — the on-device row costs
 * nothing per token and a large one-off download, which inverts the whole
 * calculation at low volume and is the reason /ask does extractive retrieval
 * rather than calling anything.
 */
export const MODELS: ModelCost[] = [
  {
    id: "extractive",
    label: "Extractive (what /ask does)",
    inputPerMillion: 0,
    outputPerMillion: 0,
    contextTokens: Infinity,
    location: "device",
    note: "No model at all. Sentences are selected from retrieved passages and scored against the query. Cannot paraphrase, cannot be wrong about a fact it did not retrieve.",
  },
  {
    id: "webllm-q4",
    label: "Llama 3.2 1B, 4-bit on device",
    inputPerMillion: 0,
    outputPerMillion: 0,
    contextTokens: 4096,
    location: "device",
    downloadMb: 880,
    note: "Runs in the visitor's browser via WebGPU. Free per token and an 880MB download that is cached afterwards — the entire cost is borne once, by the visitor, on a connection you do not control.",
  },
  {
    id: "webllm-q4-3b",
    label: "Llama 3.2 3B, 4-bit on device",
    inputPerMillion: 0,
    outputPerMillion: 0,
    contextTokens: 4096,
    location: "device",
    downloadMb: 2100,
    note: "Noticeably better, and 2.1GB. On a phone this is the difference between a demo people try and a demo people abandon at the progress bar.",
  },
  {
    id: "hosted-small",
    label: "A small hosted model",
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    contextTokens: 128_000,
    location: "hosted",
    note: "Indicative mid-2026 pricing for the cheapest tier of a frontier provider. Better than either on-device option and adds a per-request cost, a network dependency and a key to protect.",
  },
];

export interface CostEstimate {
  model: ModelCost;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** True when the prompt does not fit the context window. */
  overflows: boolean;
}

export function estimateCost(
  model: ModelCost,
  inputTokens: number,
  outputTokens: number,
): CostEstimate {
  return {
    model,
    inputTokens,
    outputTokens,
    usd:
      (inputTokens / 1_000_000) * model.inputPerMillion +
      (outputTokens / 1_000_000) * model.outputPerMillion,
    overflows: inputTokens + outputTokens > model.contextTokens,
  };
}

export interface PromptBudget {
  systemTokens: number;
  contextTokens: number;
  questionTokens: number;
  reservedForAnswer: number;
  total: number;
  limit: number;
  /** How many retrieved passages fit before the budget is spent. */
  fits: boolean;
}

/**
 * Whether a RAG prompt fits, and where the tokens went.
 *
 * **The reservation is the part people get wrong.** A context window is shared
 * between the prompt and the completion, so filling it with retrieved passages
 * leaves no room to answer — and the failure mode is not an error, it is a reply
 * that stops mid-sentence. Reserving the answer budget *before* deciding how
 * many passages to include is what prevents that, and it is why retrieval
 * quality matters more than retrieval quantity: the top 3 of 5 is the same
 * prompt as the top 3 of 500 if the ranking is right.
 */
export function budgetFor(
  parts: { system: string; passages: string[]; question: string },
  model: ModelCost,
  reservedForAnswer = 512,
): PromptBudget {
  const systemTokens = estimateTokens(parts.system);
  const contextTokens = parts.passages.reduce(
    (total, passage) => total + estimateTokens(passage),
    0,
  );
  const questionTokens = estimateTokens(parts.question);
  const total = systemTokens + contextTokens + questionTokens + reservedForAnswer;

  return {
    systemTokens,
    contextTokens,
    questionTokens,
    reservedForAnswer,
    total,
    limit: model.contextTokens,
    fits: total <= model.contextTokens,
  };
}

/**
 * Fit as many passages as the budget allows, highest-ranked first.
 *
 * Truncating the *list* rather than the text: half a passage is worse than no
 * passage, because a model asked to ground an answer in a sentence that stops
 * mid-clause will confidently complete it.
 */
export function fitPassages(
  passages: string[],
  model: ModelCost,
  overheadTokens: number,
  reservedForAnswer = 512,
): { kept: string[]; dropped: number; usedTokens: number } {
  const available = model.contextTokens - overheadTokens - reservedForAnswer;
  const kept: string[] = [];
  let used = 0;

  for (const passage of passages) {
    const cost = estimateTokens(passage);
    if (used + cost > available) break;
    kept.push(passage);
    used += cost;
  }

  return { kept, dropped: passages.length - kept.length, usedTokens: used };
}
