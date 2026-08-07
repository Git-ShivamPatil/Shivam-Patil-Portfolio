import type { Metadata } from "next";
import { achievements } from "../achievements";
import { AnimatedMetric } from "../../components/animated-metric";

export const metadata: Metadata = {
  title: "Achievements — Shivam Patil",
  alternates: { canonical: "/achievements" },
};

export default function AchievementsPage() {
  return (
    <>
      <section className="page-hero shell">
        <p className="eyebrow">Achievements</p>
        <h1>
          Outcomes,
          <br />
          <em>quantified.</em>
        </h1>
        <p>
          Results pulled directly from the project case studies and production work already on this
          site — the numbers behind the systems, in one place.
        </p>
      </section>

      <div className="achievement-grid shell">
        {achievements.map((item) => (
          <div key={`${item.metric}-${item.label}`} className="achievement-card">
            <strong>
              <AnimatedMetric value={item.metric} />
            </strong>
            <p>{item.label}</p>
            <span className="achievement-source">{item.source}</span>
          </div>
        ))}
      </div>
    </>
  );
}
