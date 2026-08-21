import { pageMetadata } from "../../lib/seo/metadata";
import { JsonLd } from "../../components/seo/json-ld";
import { breadcrumbJsonLd, itemListJsonLd } from "../../lib/seo/structured-data";
import { LOG_ENTRIES } from "../../lib/engineering-log";
import "./engineering-log.css";

export const metadata = pageMetadata({
  title: "Engineering log",
  description:
    "Eight bugs, and the wrong theory I held before finding each one. Symptom, hypothesis, the measurement that killed it, the fix, and the test that pins it.",
  path: "/engineering-log",
});

/**
 * P27 — the engineering log.
 *
 * Static: the entries are a hand-curated constant, so there is nothing to
 * revalidate and no database read to degrade.
 *
 * The page is deliberately plain. Its content is the argument, and a heavily
 * designed treatment would make it look like marketing — which is the one thing
 * it must not read as, because the whole premise is that these are unflattering
 * and true.
 */
export default function EngineeringLogPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Engineering log", href: "/engineering-log" }]),
          itemListJsonLd(
            "Engineering log",
            LOG_ENTRIES.map((entry) => ({
              name: entry.title,
              href: `/engineering-log#${entry.id}`,
              description: entry.symptom,
            })),
          ),
        ]}
      />

      <section className="log-hero shell" data-reveal>
        <p className="eyebrow">Engineering log</p>
        <h1 data-split>Eight bugs, and what I believed before I found them</h1>
        <p className="log-lede">
          A changelog is written by someone who already knows the answer, which is why every fix in
          one looks inevitable. The interesting part of debugging is the gap between noticing
          something is wrong and knowing why — the wrong theory you held, and what finally ruled it
          out.
        </p>
        <p className="log-lede">
          So every entry here carries a <strong>hypothesis</strong> field: what I actually believed
          before the measurement, including the times it was wrong. Three of the eight below are
          cases where I was confidently wrong and the measurement said so.
        </p>
        <p className="log-note">
          Each entry names the commit and the test that now pins it. An unfalsifiable war story is
          just a story — everything here can be checked against the diff.
        </p>
      </section>

      <ol className="log-list shell">
        {LOG_ENTRIES.map((entry) => (
          <li key={entry.id} id={entry.id} className="log-entry" data-reveal>
            <header className="log-entry__head">
              <span className="log-entry__meta">
                <span className="log-entry__phase">{entry.phase}</span>
                <time dateTime={entry.date}>{entry.date}</time>
                {entry.commit ? <code className="log-entry__commit">{entry.commit}</code> : null}
              </span>
              <h2>{entry.title}</h2>
            </header>

            <dl className="log-entry__body">
              <div>
                <dt>Symptom</dt>
                <dd>{entry.symptom}</dd>
              </div>
              {/* The field that makes this a log rather than a changelog. Marked
                  up distinctly so a reader skimming can find it, because it is
                  the one they will not have seen on anyone else's site. */}
              <div className="log-entry__hypothesis">
                <dt>What I believed</dt>
                <dd>{entry.hypothesis}</dd>
              </div>
              <div className="log-entry__measurement">
                <dt>What the measurement said</dt>
                <dd>{entry.measurement}</dd>
              </div>
              <div>
                <dt>Fix</dt>
                <dd>{entry.fix}</dd>
              </div>
              <div>
                <dt>What stops it coming back</dt>
                <dd>{entry.invariant}</dd>
              </div>
            </dl>

            {entry.lesson ? <p className="log-entry__lesson">{entry.lesson}</p> : null}
          </li>
        ))}
      </ol>
    </>
  );
}
