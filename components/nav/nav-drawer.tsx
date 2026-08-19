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
import { ROUTE_GROUPS, routesInGroup } from "../../lib/site-routes";
import { person } from "../../lib/seo/site";
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

/**
 * The link set comes from lib/site-routes.ts now, not from a copy kept here.
 *
 * It used to be a nineteen-link literal in this file, and the drift that caused
 * is what motivated the registry: the drawer's list, the homepage hub's list
 * and the sitemap's list were three hand-maintained versions of the same route
 * map, and ten indexable pages that the drawer linked were missing from the
 * sitemap entirely.
 *
 * Two things carried over from that literal because they were right:
 *
 * - **The prefetch rule.** ON for the static and ISR routes, which come off the
 *   CDN, so a warm cache is free. OFF for the server-rendered ones, where a
 *   prefetch is a full server render plus Neon queries — measured at 538ms
 *   (/services), 568ms (/stats) and 384ms (/search) of pure waste. It matters
 *   more here than anywhere: the drawer puts every link into the viewport in
 *   one frame, so without the flags a single open fires several server renders
 *   for pages nobody asked for. The flags now live on the route objects.
 *
 * - **The grouping.** Six groups, re-labelled. "Playground" became "See it
 *   running", "Profile" became "My work", "Talk" became "Work with me" — and
 *   every link gained a sentence under it. A drawer of twenty bare nouns is a
 *   list you have to already understand; the same twenty with a line each is a
 *   directory you can read.
 */
const EXTERNAL_LINKS = [
  { href: person.github, label: "GitHub", blurb: "The source for all of this." },
  { href: person.linkedin, label: "LinkedIn", blurb: "The professional version." },
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
          {ROUTE_GROUPS.filter((group) => group.id !== "elsewhere").map((group) => {
            const routes = routesInGroup(group.id);
            if (routes.length === 0) return null;
            return (
              <section className="nav-drawer-group" key={group.id}>
                <p className="nav-drawer-group-label">{group.label}</p>
                {routes.map((route) => {
                  // Stable per-route ids so the label can be the accessible
                  // NAME and the blurb the accessible DESCRIPTION. See below.
                  const slug = route.href.replace(/\W+/g, "-");
                  return (
                    <Link
                      key={route.href}
                      className="nav-drawer-link"
                      href={route.href}
                      prefetch={route.prefetch}
                      aria-current={pathname === route.href ? "page" : undefined}
                      // Without these two, the accessible name is every string
                      // inside the link concatenated — "Projects Case studies
                      // Six builds, each with the reasoning behind it." — for
                      // all twenty-two links. A screen-reader user arrowing the
                      // drawer would hear three lines per item before learning
                      // what the next one is.
                      //
                      // Splitting them is what the two attributes are for: the
                      // name is what the link IS, the description is detail a
                      // reader can wait for or skip. Both point at visible text
                      // rather than inventing a string, so nothing is announced
                      // that is not on screen.
                      aria-labelledby={`nav-label-${slug}`}
                      aria-describedby={`nav-blurb-${slug}`}
                      onClick={close}
                    >
                      <span className="nav-drawer-link-label" id={`nav-label-${slug}`}>
                        {route.label}
                      </span>
                      {/* The discipline name, kept as secondary text rather than
                          dropped. A recruiter scanning for "SRE" or "MLOps"
                          should still hit it, and those terms are real search
                          signal — but they lead with the plain words now.
                          Outside the labelled span, so it does not become part
                          of the link's name. */}
                      {route.technicalLabel ? (
                        <span className="nav-drawer-link-tech">{route.technicalLabel}</span>
                      ) : null}
                      <span className="nav-drawer-link-blurb" id={`nav-blurb-${slug}`}>
                        {route.blurb}
                      </span>
                    </Link>
                  );
                })}
              </section>
            );
          })}

          <section className="nav-drawer-group">
            <p className="nav-drawer-group-label">Elsewhere</p>
            {EXTERNAL_LINKS.map((link) => (
              <a
                key={link.href}
                className="nav-drawer-link"
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                onClick={close}
              >
                <span className="nav-drawer-link-label">
                  {link.label} <span aria-hidden="true">↗</span>
                </span>
                <span className="nav-drawer-link-blurb">{link.blurb}</span>
              </a>
            ))}
          </section>
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
