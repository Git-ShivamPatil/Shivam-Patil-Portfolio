/**
 * P27 — the engineering log.
 *
 * ### Why this page exists
 *
 * This repository carries a 3,000-line handoff document that is, by some
 * distance, the most useful thing in it — and no visitor has ever been able to
 * read a word of it. It records what broke, what was believed at the time, and
 * what the measurement actually said. That record is the evidence of how the
 * work is done, and it was invisible.
 *
 * ### The schema is the argument
 *
 * Every entry carries a `hypothesis` — **what was believed before the
 * measurement, stated plainly, including when it was wrong.** That field is the
 * reason this page is not a changelog.
 *
 * A changelog says what changed. It is written after the fact, by someone who
 * already knows the answer, and it therefore makes every fix look inevitable.
 * The interesting part of debugging is the interval between noticing something
 * is wrong and knowing why — the wrong theory you held, what it cost, and what
 * finally ruled it out. Almost nobody writes that down, because it is the part
 * that does not flatter.
 *
 * So the rule for adding an entry: **if you knew the cause immediately, it does
 * not belong here.** A bug that was obvious teaches nothing. The ones worth
 * publishing are the ones where a reasonable person believed a reasonable
 * thing and reality disagreed.
 *
 * ### Everything here is checkable
 *
 * Each entry names a commit and the invariant test that now pins it. That is
 * deliberate: an unfalsifiable war story is just a story. A reader who doubts
 * any line of this can open the commit and read the test.
 */

export interface LogEntry {
  /** Stable slug, used as the anchor id. */
  id: string;
  /** Roadmap phase this happened in. */
  phase: string;
  date: string;
  title: string;
  /** What was observed. No cause, no interpretation — only the symptom. */
  symptom: string;
  /**
   * What was believed, and why it was reasonable. Where this turned out to be
   * wrong, it says so — that is the field's entire purpose.
   */
  hypothesis: string;
  /** The measurement that settled it. The pivot of every entry. */
  measurement: string;
  fix: string;
  /** What stops it coming back. A fix with no invariant is a fix with a timer on it. */
  invariant: string;
  /** Short git SHA, so any claim here can be checked against the diff. */
  commit?: string;
  /** The transferable rule, if there is one. Not every entry has one. */
  lesson?: string;
}

/**
 * Newest first.
 *
 * Hand-curated rather than generated from the handoff document. The handoff is
 * written for whoever picks the work up next and assumes all of its own
 * context; these are rewritten for someone who has never seen the codebase.
 */
export const LOG_ENTRIES: LogEntry[] = [
  {
    id: "metering-multiplier",
    phase: "P27",
    date: "2026-08-21",
    title: "The rate-limit table that would have throttled everyone",
    symptom:
      "Nothing was broken yet. API keys were being added to a site whose endpoints had always been anonymous and free, and the first design had one budget per tier for the whole API.",
    hypothesis:
      "That an API has a rate limit, so tiers are absolute numbers: anonymous gets one budget, a free key a larger one, a paid key larger still. This is how essentially every metering tutorial presents it, and it is wrong for any API whose routes cost different amounts.",
    measurement:
      "Reading the three routes before writing the table. /api/rpc allowed 30 burst, /api/graphql 20, /api/ai/ask 12 — each sized for what that route actually costs, the last one because it runs an embedding plus two Postgres queries. A single ANONYMOUS budget had to pick one number, and any number it picked was wrong for two of the three.",
    fix: "Tiers became multipliers on each route's own baseline instead of absolute values. ANONYMOUS is ×1 — literally the number the route already enforced — so introducing keys changes nothing for anyone who does not hold one.",
    invariant:
      "A test asserts that across several baselines, no tier ever receives a smaller capacity or refill rate than ANONYMOUS. The near-miss version would have cut the RPC endpoint's burst by more than half for every anonymous caller, and nothing outside that test would have noticed.",
    commit: "4cd4073",
    lesson:
      "A feature that adds capability must be checked for what it silently removes. The question 'what does this take away from someone who does not use it?' has an answer more often than it looks.",
  },
  {
    id: "uniformly-slow",
    phase: "P27",
    date: "2026-08-21",
    title: "A slow endpoint is not a sick endpoint",
    symptom:
      "A newly written adaptive concurrency limiter was under test. The suite asserted that a route taking 2 seconds per request would end up more throttled than one taking 5ms. It failed: both ended up at the ceiling.",
    hypothesis:
      "That the failing assertion was catching a bug in the limiter — that a route this slow obviously ought to be shedding load.",
    measurement:
      "Working the arithmetic back through the gradient. The limit is derived from longRTT/shortRTT, a route's current latency against its own best. A route that has always taken 2s converges to longRTT ≈ shortRTT, a gradient of 1.0, and opens fully. The limiter was correct and the test was wrong.",
    fix: "The test was rewritten to assert the real property — that a route which DEGRADES closes, while one that stays fast does not — and a second test was added pinning the surprising behaviour explicitly, so nobody 'fixes' it later.",
    invariant:
      "Two tests now sit side by side: one asserting a uniformly slow route stays open, one asserting a degrading route closes while a healthy sibling does not.",
    commit: "e98f810",
    lesson:
      "When a test fails, the test is a suspect too. This one encoded an assumption about what the algorithm should do that the algorithm had never claimed. An absolute latency ceiling is a different mechanism — a circuit breaker — and the codebase already had one.",
  },
  {
    id: "link-tag-never-rendered",
    phase: "P27",
    date: "2026-08-21",
    title: "Three ways to emit one link tag, none of which worked",
    symptom:
      "A `<link rel=\"alternate\">` advertising a new machine-readable document was declared through the framework's metadata API. It appeared in no page's HTML.",
    hypothesis:
      "That a page setting its own `alternates` was replacing the layout's object wholesale rather than merging with it. This was a genuinely reasonable theory — the handoff document already recorded that exact behaviour biting once before — so the declaration was moved into the shared per-page metadata helper.",
    measurement:
      "Still absent. Driving a real browser against a production build and grepping the served HTML: zero occurrences of the string anywhere. The framework does not emit that field at all. A third attempt — rendering the element directly and relying on React's hoisting — did work, but only on dynamically rendered routes; on the prerendered ones it never appeared.",
    fix: "The tag was removed. A tag present on some pages and absent on others makes a claim about the site that is true in one place and false in another.",
    invariant:
      "None, and that is the honest outcome. What is kept is the written record of all three attempts, so the next person does not spend an afternoon rediscovering that the documented field emits nothing.",
    commit: "efc129e",
    lesson:
      "Documentation describes intent; the response body describes behaviour. Every check short of opening a browser agreed this worked, because every check short of opening a browser was reading the source rather than the output.",
  },
  {
    id: "booking-reference",
    phase: "P27",
    date: "2026-08-21",
    title: "The obvious fix would have opened an enumeration hole",
    symptom:
      "The oldest known defect in the repository: booking references are randomly generated and unique-constrained, and the row was created with no retry. A collision returns a 500 to a customer at the exact moment they are trying to pay.",
    hypothesis:
      "That the right fix was to make collisions impossible — replace the random suffix with a monotonic counter. This removes the failure by construction, which is almost always better than handling it.",
    measurement:
      "Reading what consumes the reference before changing how it is produced. The post-checkout page looks a booking up BY reference and renders the customer's name, email, service and amount to whoever holds it. The reference is a bearer token in practice. A counter would let anyone read every booking on the site by incrementing a number.",
    fix: "The reference stays random and the writer retries on collision, scoped to that specific column so an unrelated constraint failure is not silently swallowed. A 1-in-550,000 error that is handled, rather than a permanent enumeration hole.",
    invariant:
      "Tests assert the retry generates a NEW value each attempt — a loop resubmitting the value that just collided can never succeed — and that a unique violation on any other column is re-thrown rather than retried.",
    commit: "896cbe7",
    lesson:
      "'Impossible by construction' is the right instinct and it still has to be checked against what depends on the current construction. The identifier was doing a second job nobody had written down.",
  },
  {
    id: "sbom-only-passed-locally",
    phase: "P26c",
    date: "2026-08-20",
    title: "A check that could not pass on any machine but the one that wrote it",
    symptom:
      "A supply-chain manifest was committed with a CI job asserting it stayed current. The job failed on every run, naming a line number in a 15,000-line file.",
    hypothesis:
      "That a dependency had drifted since the file was generated — the exact thing the check exists to catch.",
    measurement:
      "Comparing the two documents by category rather than by line. The counts matched for platform-independent packages and diverged entirely for platform-specific ones: the committed file described a Windows dependency tree, and CI runs on Linux. The check was comparing metadata that is a property of where the file was generated, not of what the project depends on.",
    fix: "The check now compares the sorted package-URL list — namespace, name, version. Exactly what 'a dependency moved' means, and the only part independent of the generating machine. Failure output names the packages added and removed instead of a line number.",
    invariant:
      "Verified three ways before pushing: unchanged tree passes; artifact mutated to look Linux-generated passes and says why it is not byte-identical; one real package swapped for a fake fails, naming both.",
    commit: "e48298e",
    lesson:
      "The obvious fix was to strip the platform-specific fields from the artifact too. It was rejected because a page in the app reads those fields to build a licence breakdown — deleting a real feature to make a test pass.",
  },
  {
    id: "cls-one-hyphen",
    phase: "P26d",
    date: "2026-08-19",
    title: "The layout shift was one hyphen",
    symptom:
      "Lighthouse reported cumulative layout shift of 0.032 against a budget of 0.02. The aggregate number named no page and no element, and the audit that exists to identify shifting nodes returned empty on every run.",
    hypothesis:
      "The self-hosted font fallback. A recent change had added a large block of text to three pages, and font swap is the textbook cause of layout shift — so the metric-matched fallback was the obvious suspect.",
    measurement:
      "Forcing the fallback font on each new block and comparing rendered heights: −3px on a 1108px block, −2px on a 349px block, 0 on the rest. That cannot produce 0.032. The suspect was measured and cleared. What actually found it was a PerformanceObserver on layout-shift at Lighthouse's own viewport, reading the shifting nodes directly — which named three elements and their exact deltas in one call.",
    fix: "A heading ended in a hyphenated word. Text-splitting wrapped each word in a non-breaking span, turning that word into one unbreakable 652px token. A bare `fr` grid track is `minmax(auto, 1fr)`, so the column grew to fit it and stole 82px from the photo beside it — which, being aspect-ratio constrained, became 102px shorter, moving every section below it.",
    invariant:
      "A browser test asserts that on the two pages where a split heading sits beside a sized element, no split word is ever wider than its heading. Both hero grids also moved to `minmax(0, …)`.",
    commit: "4f41773",
    lesson:
      "Measuring the obvious suspect is worth doing even when you are sure — clearing it is what forced the search somewhere else. And a bare `fr` track is a content-sized track in disguise.",
  },
  {
    id: "eval-indicted-itself",
    phase: "P25",
    date: "2026-08-17",
    title: "The evaluation found that retrieval had been half-dead for two phases",
    symptom:
      "A newly built retrieval evaluation returned 42% recall on its first run, with seven queries missing the page a human had judged correct.",
    hypothesis:
      "That the ranking was mediocre and needed tuning — the ordinary reading of a low recall number.",
    measurement:
      "Inspecting which retriever matched each result, rather than only the score. Across three unrelated queries and thirty-six results, not one had been matched by the lexical half. Every fused score was exactly 1/(60+rank) — the arithmetic signature of rank fusion running on a single list. The site had been describing its search as hybrid while running on one leg since the feature shipped.",
    fix: "The lexical query builder ANDed every term, so a natural-language question with several words matched nothing. A second pass ORs the terms when the strict pass finds nothing, which is what a candidate generator should do — precision comes from the ranking and the fusion, not from refusing to look at a document missing one word of the question.",
    invariant:
      "The evaluation now runs in CI with a floor, and reports coverage separately from ranking. The judgements were deliberately NOT edited to match the results.",
    commit: "32f3f68",
    lesson:
      "Build the measurement even when you believe the thing works. This one indicted two phases of prior work on its first run — and a metric that can only confirm you is not a measurement.",
  },
  {
    id: "blank-page-twice",
    phase: "P17 / P24",
    date: "2026-08-16",
    title: "The same bug, shipped twice, and the second one was silent",
    symptom:
      "Every client-side navigation rendered a blank page. Every route returned 200 with complete, correct HTML, and repeated automated sweeps found nothing wrong.",
    hypothesis:
      "A routing or data-fetching fault, since the pages were empty. That framing is what kept the sweeps pointed at the server, where they all came back clean.",
    measurement:
      "Clicking, in a real browser, instead of fetching. An effect keyed on the pathname was querying the DOM while the page-transition wrapper still had the OUTGOING page mounted — so it decorated elements that were about to be destroyed, and the incoming page arrived undecorated and invisible.",
    fix: "A MutationObserver, so the work happens when the new nodes actually exist rather than when the URL changes.",
    invariant:
      "Recorded as a standing rule: an effect keyed on pathname that calls querySelectorAll is that bug. Browser tests now navigate by clicking rather than by fetching.",
    lesson:
      "The second occurrence is the instructive one. The same mistake in a different component killed all pointer interaction after any navigation and shipped unnoticed for weeks, because it degraded quietly instead of failing loudly. A bug that announces itself is the cheap kind.",
  },
];

/** One entry by slug, for deep links. */
export function entryById(id: string): LogEntry | undefined {
  return LOG_ENTRIES.find((entry) => entry.id === id);
}
