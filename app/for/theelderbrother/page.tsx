import type { Metadata } from "next";
import Link from "next/link";
import { mailtoHref } from "../../../lib/site-contact";
import "../for.css";

export const metadata: Metadata = {
  title: "theelderbrother — Shivam Patil",
  description:
    "A platform where older men tell younger men how life actually works, so they can choose their days deliberately instead of finding out late.",
  alternates: { canonical: "/for/theelderbrother" },
};

/**
 * The manifesto for an app that does not exist yet.
 *
 * Deliberately its own route rather than a section on the homepage: it is an
 * idea being argued for, not a portfolio entry, and it wants to be linkable on
 * its own — which is also the whole reason the IA work gave things addresses.
 */

const TOPICS = [
  { n: "01", text: "Choosing a career — before the choice quietly gets made for you" },
  { n: "02", text: "Dating, honestly: what works, what wastes years" },
  { n: "03", text: "Modelling, presence, and being taken seriously in a room" },
  { n: "04", text: "Skincare and grooming, without the twelve-step upsell" },
  { n: "05", text: "UFC, boxing, and what training actually does to you" },
  { n: "06", text: "Travel — where to go young, and what it costs to wait" },
  { n: "07", text: "Jail: what it is really like, from men who were in it" },
  { n: "08", text: "Money, law and government — the parts school skips" },
  { n: "09", text: "What matters, and the far harder question of when" },
];

export default function TheElderBrotherPath() {
  return (
    <div className="path-shell">
      <section className="path-hero" data-reveal>
        <p className="eyebrow">
          <span className="live-dot" />
          An idea I want to build
        </p>
        <h1 data-split>theelderbrother</h1>
        <p>
          A social platform with one job: let men who have already lived through something tell the
          men who are about to. Not influencers. Not a course. Older brothers.
        </p>
      </section>

      <section className="path-section" data-reveal>
        <h2>Where this comes from</h2>
        <p className="tebro-quote">
          In 12th grade, I didn&apos;t know how business, law, or government worked. I thought life
          was just engineering, a job, buying a flat, and marriage.
        </p>
        <p>
          Nobody was hiding it from me. There was simply no one a few steps ahead whose job it was
          to say{" "}
          <em>here is what is actually coming, and here is what it costs to find out late.</em> Most
          of what I know now arrived years after the decision it should have informed. That gap is
          the entire product.
        </p>
      </section>

      <section className="path-section" data-reveal>
        <h2>What it is for</h2>
        <p>
          A dedicated place where older men guide younger men through the realities of life, so they
          can choose their daily actions deliberately rather than discovering the shape of things
          afterwards. The unit is lived experience, and the person giving it has already paid for
          it.
        </p>
      </section>

      <section className="path-section" data-reveal>
        <h2>What gets talked about</h2>
        <p>
          Concrete things, from people who did them — the topics that are usually either sold as a
          course or left to a group chat.
        </p>
        <ul className="tebro-topics">
          {TOPICS.map((topic) => (
            <li key={topic.n}>
              <span aria-hidden="true">{topic.n}</span>
              <span>{topic.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="path-section" data-reveal>
        <h2>It is a concept, not a launch</h2>
        <p>
          There is no signup, because there is nothing to sign up to yet. If you have built
          something like this, think it is a bad idea, or want to argue about the moderation problem
          sitting at the middle of it — that conversation is the useful one.
        </p>
        <div className="path-card-links">
          <a href={mailtoHref("theelderbrother")}>Email me about it</a>
          <Link href="/reach-out">Other ways to reach me</Link>
        </div>
      </section>
    </div>
  );
}
