import { ArrowUpRight } from "../icons";

/**
 * Cal.com scheduling.
 *
 * Rendered as a plain link-out rather than the official embed script: the
 * embed injects a third-party iframe and its own bundle on every visit to
 * /services, and the same job is done by a link the visitor clicks once. When
 * CAL_USERNAME isn't configured this renders nothing rather than a dead
 * "Book a time" button that goes to a 404.
 */
export function CalEmbed() {
  const username = process.env.CAL_USERNAME;
  const eventSlug = process.env.CAL_EVENT_SLUG ?? "30min";
  if (!username) return null;

  const url = `https://cal.com/${username}/${eventSlug}`;

  return (
    <section className="cal-section shell" data-reveal>
      <div>
        <p className="eyebrow">Free intro call</p>
        <h2>
          Not sure yet?
          <br />
          <em>Start with 30 minutes.</em>
        </h2>
        <p className="cal-copy">
          No charge, no obligation — a short call to work out whether a paid session is even the
          right thing. Scheduling runs on Cal.com, so it reads my real availability.
        </p>
      </div>
      <a href={url} target="_blank" rel="noreferrer" className="button button-light" data-magnetic>
        See available times <ArrowUpRight />
      </a>
    </section>
  );
}
