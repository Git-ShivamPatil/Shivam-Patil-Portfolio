"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * P16 — the résumé analyser.
 *
 * Paste a job description, get back how much of it this portfolio can actually
 * evidence, with the passage that proves each covered requirement.
 *
 * **The evidence is the point, not the percentage.** A coverage number on its
 * own is a claim nobody can check; "React — covered, and here is the case study
 * paragraph that shows it" is one a reader can click. So gaps are listed as
 * plainly as matches: a tool that only reports what it found would be flattery
 * with a progress bar on it.
 */

interface RequirementMatch {
  requirement: string;
  covered: boolean;
  matchedTerms: string[];
  evidence: { title: string; url: string; excerpt: string } | null;
}

interface Analysis {
  coverage: number;
  requirements: RequirementMatch[];
  matchedSkills: string[];
  missingSkills: string[];
  parsed: number;
  error?: string;
}

export function JdMatch() {
  const [text, setText] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyse(event: React.FormEvent) {
    event.preventDefault();
    if (text.trim().length < 40) return;

    setRunning(true);
    setError(null);
    setAnalysis(null);

    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await response.json()) as Analysis;
      if (!response.ok) {
        setError(json.error ?? "Could not analyse that.");
        return;
      }
      setAnalysis(json);
    } catch {
      setError("Could not reach the analyser.");
    } finally {
      setRunning(false);
    }
  }

  const covered = analysis?.requirements.filter((row) => row.covered) ?? [];
  const gaps = analysis?.requirements.filter((row) => !row.covered) ?? [];

  return (
    <div className="jd-match">
      <form onSubmit={analyse}>
        <label htmlFor="jd-input" className="jd-label">
          Paste a job description
        </label>
        <textarea
          id="jd-input"
          value={text}
          rows={8}
          placeholder="Paste the requirements section — bullets work best."
          onChange={(event) => setText(event.target.value)}
        />
        <div className="jd-actions">
          <button
            type="submit"
            className="button button-solid"
            disabled={running || text.trim().length < 40}
            data-ripple
          >
            {running ? "Matching…" : "Match against my work"}
          </button>
          <span className="ask-note">
            Nothing pasted here is stored. It is read, matched against the index, and dropped.
          </span>
        </div>
      </form>

      {error && (
        <p className="ask-error" role="alert">
          {error}
        </p>
      )}

      {analysis && (
        <div className="jd-result">
          <div className="jd-score">
            <strong>{analysis.coverage}%</strong>
            <span>
              of {analysis.parsed} requirement{analysis.parsed === 1 ? "" : "s"} backed by something
              on this site
            </span>
          </div>

          <p className="ask-note">
            Matching is by term overlap against the same index the search uses — not a model
            reading for meaning. A requirement phrased in words this site never uses will show as a
            gap even when the experience is there, so read the evidence rather than the number.
          </p>

          {analysis.matchedSkills.length > 0 && (
            <div className="jd-chips">
              <h3>Named in the description and listed here</h3>
              <ul className="skill-chip-list">
                {analysis.matchedSkills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </div>
          )}

          {analysis.missingSkills.length > 0 && (
            <div className="jd-chips">
              <h3>Mentioned there, not found here</h3>
              <ul className="skill-chip-list jd-chips-missing">
                {analysis.missingSkills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </div>
          )}

          {covered.length > 0 && (
            <div className="jd-list">
              <h3>Covered ({covered.length})</h3>
              <ul>
                {covered.map((row) => (
                  <li key={row.requirement}>
                    <p className="jd-requirement">{row.requirement}</p>
                    {row.evidence && (
                      <blockquote>
                        {row.evidence.excerpt}…
                        <Link href={row.evidence.url}>{row.evidence.title}</Link>
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gaps.length > 0 && (
            <div className="jd-list jd-list-gaps">
              <h3>No evidence found ({gaps.length})</h3>
              <ul>
                {gaps.map((row) => (
                  <li key={row.requirement}>
                    <p className="jd-requirement">{row.requirement}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
