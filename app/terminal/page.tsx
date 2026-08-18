import { pageMetadata } from "../../lib/seo/metadata";
import Link from "next/link";
import { Terminal } from "../../components/devex/terminal";
import { TERMINAL_COMMANDS } from "../../lib/devex/commands";

export const metadata = pageMetadata({
  title: "Terminal: Browse This Site by Command",
  description:
    "A real terminal in the page. Type help, whoami or projects and read this portfolio the way an engineer would rather than by scrolling.",
  path: "/terminal",
});

export default function TerminalPage() {
  return (
    <div className="shell py-16">
      <section className="page-hero" data-reveal>
        <p className="eyebrow">Interface</p>
        <h1 data-split>
          A shell for
          <br />
          <em>this website.</em>
        </h1>
        <p className="page-lede">
          Not a typewriter animation. It parses what you type, drives the real router, changes the
          real theme, and <code>ask</code> runs the same retrieval index the{" "}
          <Link href="/ask">Ask page</Link> uses — so it can answer questions about the site, with
          sources, from a prompt.
        </p>
      </section>

      <section className="mt-10" data-reveal>
        <Terminal />
      </section>

      <section className="mt-12" data-reveal>
        <div className="section-heading">
          <h2>
            Every <em>command.</em>
          </h2>
          <p>
            Also available anywhere on the site with <kbd>⌘</kbd>
            <kbd>K</kbd> — or just <kbd>/</kbd> when you are not typing in a field.
          </p>
        </div>
        <div className="border-app-line overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
                <th className="px-4 py-3 font-semibold">Usage</th>
                <th className="px-4 py-3 font-semibold">What it does</th>
              </tr>
            </thead>
            <tbody>
              {TERMINAL_COMMANDS.map((command) => (
                <tr key={command.name} className="border-app-line border-b last:border-0">
                  <td className="text-app-fg px-4 py-3 font-mono text-xs">{command.usage}</td>
                  <td className="text-app-muted px-4 py-3">{command.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
