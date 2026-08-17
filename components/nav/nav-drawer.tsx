"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DrawerAuth } from "./drawer-auth";
import "./nav.css";

/**
 * The site's primary navigation: the hamburger and the panel it controls.
 *
 * They ship as one component because the open state is the only thing they
 * share, and keeping it here means components/header.tsx never needs a "use
 * client" boundary — the wordmark, the photo and the top-bar links all stay
 * server-rendered.
 *
 * The link set is the whole public route map. Before this, /terminal, /compute
 * and /data had no <Link> pointing at them anywhere in the repo — the only way
 * in was guessing that Cmd+K existed — and /skills, /experience,
 * /certifications, /achievements and /resume were reachable only from the
 * footer row this drawer replaces.
 */

type DrawerLink = {
  href: string;
  label: string;
  /** Only ever `false`, and only on the `ƒ` routes — see NAV_GROUPS. */
  prefetch?: false;
  external?: true;
};

/**
 * prefetch stays ON for the static/ISR routes: those come off the CDN, so a
 * warm cache is free and navigation is instant. It is OFF for the server-
 * rendered ones, where a prefetch is a full server render plus Neon queries —
 * measured at 538ms (/services), 568ms (/stats) and 384ms (/search) of pure
 * waste. /ask carries it for the same reason: its answer path reads the index
 * status out of the database.
 *
 * That matters more here than it did in the old header row. The drawer puts
 * nineteen links into the viewport in a single frame when it opens, so every
 * open would otherwise fire three server renders for pages nobody asked for.
 */
const NAV_GROUPS: { label: string; links: DrawerLink[] }[] = [
  {
    label: "Work",
    links: [
      { href: "/projects", label: "Projects" },
      { href: "/services", label: "Work with me", prefetch: false },
    ],
  },
  {
    label: "Signals",
    links: [
      { href: "/blog", label: "Blog" },
      { href: "/system-design", label: "System design" },
      { href: "/stats", label: "Live stats", prefetch: false },
      { href: "/ask", label: "Ask the site", prefetch: false },
    ],
  },
  {
    label: "Playground",
    links: [
      { href: "/terminal", label: "Terminal" },
      { href: "/compute", label: "Compute lab" },
      { href: "/data", label: "Data pipeline" },
      // Server-rendered off live reads, so prefetch stays off for the same
      // reason /stats and /services have it off.
      { href: "/reliability", label: "Reliability", prefetch: false },
      { href: "/security", label: "Security", prefetch: false },
      // Static (revalidate 3600), so prefetch stays on like the other ISR routes.
      { href: "/edge", label: "Edge & offline" },
    ],
  },
  {
    label: "Profile",
    links: [
      { href: "/about", label: "About" },
      { href: "/experience", label: "Experience" },
      { href: "/skills", label: "Skills" },
      { href: "/achievements", label: "Achievements" },
      { href: "/certifications", label: "Certifications" },
      { href: "/resume", label: "Résumé" },
    ],
  },
  {
    label: "Talk",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/reach-out", label: "Reach out" },
    ],
  },
  {
    label: "Elsewhere",
    links: [
      { href: "https://github.com/Git-ShivamPatil", label: "GitHub", external: true },
      { href: "https://www.linkedin.com/in/shivam--patil/", label: "LinkedIn", external: true },
    ],
  },
];

/* The client-only gate for the portal, as an external store rather than a
   `mounted` flag flipped in an effect. It reports false for the hydration
   render and true from then on, which is what stops React trying to reconcile a
   <body> portal against server HTML that never contained one — and it does that
   without the setState-in-an-effect the compiler lint rejects. */
const subscribeToNothing = () => () => {};
const isClient = () => true;
const isServer = () => false;

export function NavDrawer() {
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(subscribeToNothing, isClient, isServer);
  const pathname = usePathname();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  // Close on navigation, as a render-phase adjustment rather than an effect —
  // React's documented way to reset state when a value changes, and the only
  // form the compiler's set-state-in-effect rule accepts.
  //
  // It is a state write and nothing else, which is the whole reason keying on
  // pathname is safe here: the site-wide outage in HANDOFF §2z came from an
  // effect keyed on pathname that QUERIED THE DOM, and ran while
  // AnimatePresence still had the outgoing page mounted and the new subtree
  // did not exist yet. Nothing below reads the DOM for the new route.
  const [seenPathname, setSeenPathname] = useState(pathname);
  if (seenPathname !== pathname) {
    setSeenPathname(pathname);
    setOpen(false);
  }

  // Focus moves in one place rather than in each handler, so every close path —
  // the button, the scrim, Escape, a link, a route change — restores focus
  // identically. Without the restore, closing hands focus to <body> and a
  // keyboard user has to tab from the top of the document again.
  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // On window, not on the panel: Escape has to work even when focus has slipped
  // outside the trap, which it does whenever the browser puts up chrome of its
  // own (an autofill dropdown, a translate prompt).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Restore whatever was there before rather than clearing to "". Something
  // else on the page may own body overflow at the time — the image-gallery
  // lightbox is the live example — and blanking it would silently unlock a
  // scroll that another overlay still wants locked.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const trapTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const drawer = (
    <>
      <div className="nav-scrim" data-open={open} aria-hidden="true" onClick={close} />

      {/* `inert` rather than visibility alone: the panel stays mounted so the
          slide has something to animate, and an off-screen transform does
          nothing to stop Tab reaching the nineteen links inside it. React 19
          passes the boolean straight through to the DOM attribute. */}
      <aside
        id="site-drawer"
        ref={panelRef}
        className="nav-drawer"
        data-open={open}
        aria-hidden={!open}
        inert={!open}
        aria-label="Site navigation"
        onKeyDown={trapTab}
      >
        <div className="nav-drawer-head">
          <p className="nav-drawer-label">Navigate</p>
          <button
            ref={closeRef}
            type="button"
            className="nav-drawer-close"
            onClick={close}
            aria-label="Close menu"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <nav className="nav-drawer-nav" aria-label="All sections">
          {NAV_GROUPS.map((group) => (
            <section className="nav-drawer-group" key={group.label}>
              <p className="nav-drawer-group-label">{group.label}</p>
              {group.links.map((link) =>
                link.external ? (
                  <a
                    key={link.href}
                    className="nav-drawer-link"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={close}
                  >
                    {link.label}
                    <span aria-hidden="true">↗</span>
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    className="nav-drawer-link"
                    href={link.href}
                    prefetch={link.prefetch}
                    aria-current={pathname === link.href ? "page" : undefined}
                    onClick={close}
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </section>
          ))}
        </nav>

        <div className="nav-drawer-foot">
          <DrawerAuth onNavigate={close} />
        </div>
      </aside>
    </>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="nav-trigger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="site-drawer"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="nav-trigger-bar" />
        <span className="nav-trigger-bar" />
        <span className="nav-trigger-bar" />
      </button>

      {/* Portalled to <body>, and it has to be. .site-header is
          `position: sticky; z-index: 20`, which makes it a stacking context —
          left inside it, the panel is pinned below .back-to-top (z-index 30,
          and it sits bottom-LEFT, directly over the drawer) and the chat
          launcher (40) whatever z-index it declares for itself. */}
      {mounted ? createPortal(drawer, document.body) : null}
    </>
  );
}
