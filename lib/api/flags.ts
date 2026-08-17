import { hashToUnit } from "../edge/waf";

/**
 * P24 — feature flag evaluation, as a pure function.
 *
 * **The evaluation is deliberately separate from the storage**, and everything
 * interesting follows from that. `evaluate` takes a flag definition and a
 * context and returns a decision; it never reads a database, never calls a
 * network, and never consults a clock it was not handed. So the same function
 * decides on the server, in a unit test, and in the browser sandbox on
 * /api-lab, and all three agree by construction rather than by discipline.
 *
 * That property is the one that matters in production too. The most expensive
 * flag bugs are not "the flag was wrong" — they are "the flag was evaluated
 * differently in two places", which produces a user who is inside the
 * experiment according to the page and outside it according to the API.
 *
 * **Percentage rollout is hashed, not random.** Same reason the canary in
 * lib/edge/waf.ts is: a random draw per evaluation puts one user on both sides
 * of a flag within a single request, and the resulting bug reports describe a
 * configuration nobody can reproduce. Hashing on `flagKey + subject` also means
 * two flags at 10% do not select the same 10% of people, which is what makes
 * concurrent experiments independent.
 */

export type FlagValue = boolean | string | number;

export interface Rule {
  /** Context attribute to test, e.g. "role", "country", "email". */
  attribute: string;
  operator: "equals" | "in" | "contains" | "endsWith" | "gte" | "lte";
  /** Compared against. `in` expects an array. */
  value: string | number | string[];
  /** Returned when the rule matches. */
  serve: FlagValue;
}

export interface Flag {
  key: string;
  description: string;
  enabled: boolean;
  /** Returned when the flag is off, or when nothing else matches. */
  fallback: FlagValue;
  /** Evaluated in order; the first match wins. */
  rules: Rule[];
  /** 0–100. Applied only after every rule has failed to match. */
  rolloutPercent: number;
  /** Served to the rollout cohort. */
  rolloutValue: FlagValue;
}

export interface Context {
  /** Stable identity for bucketing — a user id, or a visitor pseudonym. */
  subject: string;
  attributes: Record<string, string | number | undefined>;
}

export type Reason =
  "flag-disabled" | "rule-match" | "rollout-included" | "rollout-excluded" | "no-rule-matched";

export interface Decision {
  value: FlagValue;
  reason: Reason;
  /** Index of the rule that decided, when one did. */
  ruleIndex: number | null;
  /** The bucket this subject fell into, 0–100, when a rollout was consulted. */
  bucket: number | null;
}

function matches(rule: Rule, actual: string | number | undefined): boolean {
  // A missing attribute never matches. The alternative — treating `undefined`
  // as equal to an empty string — silently puts every context that omits the
  // attribute into the rule, which is how a flag intended for one country ships
  // to everyone whose geo lookup failed.
  if (actual === undefined) return false;

  switch (rule.operator) {
    case "equals":
      return String(actual) === String(rule.value);
    case "in":
      return Array.isArray(rule.value) && rule.value.map(String).includes(String(actual));
    case "contains":
      return String(actual).includes(String(rule.value));
    case "endsWith":
      return String(actual).endsWith(String(rule.value));
    case "gte":
    case "lte": {
      const left = Number(actual);
      const right = Number(rule.value);
      // Non-numeric input to a numeric operator is a configuration error, and
      // NaN comparisons are always false — which would silently mean "no
      // match" rather than "this rule is broken". Returning false is still the
      // safe answer; the flag admin surface is where it should be caught.
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return rule.operator === "gte" ? left >= right : left <= right;
    }
    default:
      return false;
  }
}

export function evaluate(flag: Flag, context: Context): Decision {
  if (!flag.enabled) {
    return { value: flag.fallback, reason: "flag-disabled", ruleIndex: null, bucket: null };
  }

  // Rules first, rollout second. A rule is a deliberate statement about a
  // specific population — "admins get the new editor" — and letting a
  // percentage rollout override it would mean an explicit targeting rule
  // silently applying to only some of the people it names.
  for (let index = 0; index < flag.rules.length; index += 1) {
    const rule = flag.rules[index];
    if (matches(rule, context.attributes[rule.attribute])) {
      return { value: rule.serve, reason: "rule-match", ruleIndex: index, bucket: null };
    }
  }

  if (flag.rolloutPercent > 0) {
    // Salted with the flag key, so two flags at 10% do not pick the same
    // people. Without the salt, every low-percentage experiment runs on the
    // same unlucky cohort and their interactions are impossible to untangle.
    const bucket = hashToUnit(`${flag.key}:${context.subject}`) * 100;
    if (bucket < flag.rolloutPercent) {
      return {
        value: flag.rolloutValue,
        reason: "rollout-included",
        ruleIndex: null,
        bucket,
      };
    }
    return { value: flag.fallback, reason: "rollout-excluded", ruleIndex: null, bucket };
  }

  return { value: flag.fallback, reason: "no-rule-matched", ruleIndex: null, bucket: null };
}

/**
 * The flags this application actually reads.
 *
 * **Defined in code, not only in a database.** A flag that exists only as a row
 * is a flag nobody can find by grepping, and the single worst property of a
 * feature-flag system is that dead flags accumulate invisibly until nobody
 * dares delete any of them. Every key here corresponds to a call site; the
 * database supplies the *values*, this supplies the inventory.
 */
export const FLAG_DEFAULTS: Flag[] = [
  {
    key: "api.graphql",
    description: "Serve the GraphQL endpoint at /api/graphql.",
    enabled: true,
    fallback: true,
    rules: [],
    rolloutPercent: 0,
    rolloutValue: true,
  },
  {
    key: "api.rpc",
    description: "Serve the protobuf RPC endpoint at /api/rpc.",
    enabled: true,
    fallback: true,
    rules: [],
    rolloutPercent: 0,
    rolloutValue: true,
  },
  {
    key: "lab.sandbox-writes",
    description:
      "Allow the API sandbox to issue requests that write. Off — the sandbox is public, and a public write console is an abuse endpoint.",
    enabled: true,
    fallback: false,
    rules: [{ attribute: "role", operator: "equals", value: "ADMIN", serve: true }],
    rolloutPercent: 0,
    rolloutValue: false,
  },
];

export function defaultFlag(key: string): Flag | null {
  return FLAG_DEFAULTS.find((flag) => flag.key === key) ?? null;
}
