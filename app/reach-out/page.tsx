import type { Metadata } from "next";
import { ArrowUpRight } from "../../components/icons";

export const metadata: Metadata = { title: "Reach out — Shivam Patil" };

interface ContactChannel {
  label: string;
  value: string;
  href: string;
  note: string;
}

const contactChannels: ContactChannel[] = [
  {
    label: "Email",
    value: "shivampatilinfo@gmail.com",
    href: "mailto:shivampatilinfo@gmail.com",
    note: "Best for roles & collaborations",
  },
  {
    label: "LinkedIn",
    value: "linkedin.com/in/shivam--patil",
    href: "https://www.linkedin.com/in/shivam--patil/",
    note: "Professional network",
  },
  {
    label: "WhatsApp",
    value: "+91 70385 73273",
    href: "https://wa.me/917038573273",
    note: "Quick message",
  },
  {
    label: "Phone",
    value: "+91 70385 73273",
    href: "tel:+917038573273",
    note: "Mumbai, India · IST",
  },
  {
    label: "GitHub",
    value: "github.com/Git-ShivamPatil",
    href: "https://github.com/Git-ShivamPatil",
    note: "Code and experiments",
  },
];

export default function ReachOutPage() {
  return (
    <section className="reach-page shell">
      <div className="reach-intro">
        <p className="eyebrow">Reach out</p>
        <h1>
          Find the
          <br />
          <em>right channel.</em>
        </h1>
        <p>
          Whether it&apos;s a role, a technical conversation, or an idea worth prototyping —
          I&apos;d be glad to hear from you.
        </p>
      </div>
      <div className="channel-list">
        {contactChannels.map((channel, index) => (
          <a
            key={channel.label}
            href={channel.href}
            target={channel.href.startsWith("http") ? "_blank" : undefined}
            rel={channel.href.startsWith("http") ? "noreferrer" : undefined}
            className="channel-row"
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <small>{channel.label}</small>
              <strong>{channel.value}</strong>
            </div>
            <p>{channel.note}</p>
            <ArrowUpRight />
          </a>
        ))}
      </div>
      <div className="resume-download">
        <div>
          <p className="eyebrow">Résumé</p>
          <h2>
            A closer look
            <br />
            at the <em>details.</em>
          </h2>
        </div>
        <a href="/Shivam-Patil-SDE-II-Resume.pdf" target="_blank" className="button button-solid">
          View latest résumé <ArrowUpRight />
        </a>
      </div>
    </section>
  );
}
