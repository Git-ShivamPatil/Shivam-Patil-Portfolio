"use client";

import { useMemo, useState } from "react";
import { MODELS, budgetFor, estimateCost, estimateTokens } from "../../lib/mlops/tokens";

/**
 * P25 — what an answer would cost, on each option this site actually had.
 *
 * Interactive because the answer inverts. At one question a day the on-device
 * model is free and the hosted one costs nothing worth measuring; the download
 * dominates completely. At a hundred thousand, the download amortises to
 * nothing and the per-token price is the entire decision. A static table picks
 * one point on that curve and implies it is the answer.
 *
 * Everything is computed in the browser from lib/mlops/tokens.ts — the same
 * module the server uses — so the figures here and the budget shown on /ask
 * cannot disagree.
 */

/**
 * Number formatting, pinned to one locale.
 *
 * **`toLocaleString()` with no argument uses the runtime's locale, and in a
 * client component that is a guaranteed hydration mismatch.** Node rendered
 * 128000 as "128,000"; the browser this was tested in has an Indian locale and
 * rendered the identical number as "1,28,000" — lakh grouping — so React threw
 * away the server HTML and re-rendered the subtree on every load.
 *
 * It is invisible in any environment where the two happen to agree, which is
 * most developer machines, and it costs a full client re-render for everyone
 * else. Pinning the locale is the fix; using the visitor's would mean this
 * component could never be server-rendered at all.
 */
const NUMBER = new Intl.NumberFormat("en-US");

const SYSTEM_PROMPT =
  "You answer questions about Shivam Patil using only the provided context. If the context does not contain the answer, say so.";

const EXAMPLE_PASSAGE =
  "The distributed rate limiter implements a token bucket in Redis, refilled lazily on read rather than by a background job. Each bucket stores a token count and a timestamp; a read computes how many tokens should have accrued since the timestamp and caps the result at the burst size. This makes the limiter O(1) per request with no scheduled work, at the cost of a small race between concurrent readers which the Lua script closes.";

export function ModelCosts() {
  const [questionsPerDay, setQuestionsPerDay] = useState(50);
  const [passages, setPassages] = useState(4);

  const rows = useMemo(() => {
    const question = "How does the rate limiter avoid a background refill job?";
    const context = Array.from({ length: passages }, () => EXAMPLE_PASSAGE);

    return MODELS.map((model) => {
      const budget = budgetFor({ system: SYSTEM_PROMPT, passages: context, question }, model);
      // 220 output tokens is a grounded two-paragraph answer — measured from
      // what /ask actually returns rather than assumed.
      const outputTokens = 220;
      const perCall = estimateCost(model, budget.total - budget.reservedForAnswer, outputTokens);
      const perYear = perCall.usd * questionsPerDay * 365;

      return { model, budget, perCall, perYear };
    });
  }, [questionsPerDay, passages]);

  const inputTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(EXAMPLE_PASSAGE) * passages;

  return (
    <div className="ml-costs">
      <div className="ml-controls">
        <label>
          <span>
            Questions a day <em>{NUMBER.format(questionsPerDay)}</em>
          </span>
          <input
            type="range"
            min={1}
            max={100000}
            step={1}
            value={questionsPerDay}
            onChange={(event) => setQuestionsPerDay(Number(event.target.value))}
          />
        </label>
        <label>
          <span>
            Passages retrieved <em>{passages}</em>
          </span>
          <input
            type="range"
            min={1}
            max={12}
            step={1}
            value={passages}
            onChange={(event) => setPassages(Number(event.target.value))}
          />
        </label>
      </div>

      <p className="ml-note">
        {NUMBER.format(inputTokens)} input tokens per question at this setting, plus 220 for the
        answer.
      </p>

      <div className="ml-table-wrap">
        <table className="ml-table">
          <caption className="sr-only">Estimated cost per option</caption>
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col">Runs</th>
              <th scope="col">Download</th>
              <th scope="col">Per question</th>
              <th scope="col">Per year</th>
              <th scope="col">Fits</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ model, budget, perCall, perYear }) => (
              <tr key={model.id}>
                <th scope="row">{model.label}</th>
                <td>{model.location === "device" ? "In the browser" : "Hosted"}</td>
                <td>{model.downloadMb ? `${(model.downloadMb / 1024).toFixed(1)} GB` : "—"}</td>
                <td>{perCall.usd === 0 ? "$0" : `$${perCall.usd.toFixed(5)}`}</td>
                <td>
                  {perYear === 0
                    ? "$0"
                    : perYear < 1
                      ? `$${perYear.toFixed(2)}`
                      : `$${NUMBER.format(Math.round(perYear))}`}
                </td>
                <td data-bad={!budget.fits || undefined}>
                  {budget.fits
                    ? `${NUMBER.format(budget.total)} / ${model.contextTokens === Infinity ? "∞" : NUMBER.format(model.contextTokens)}`
                    : "overflows"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="ml-notes">
        {MODELS.map((model) => (
          <li key={model.id}>
            <strong>{model.label}</strong>
            <span>{model.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
