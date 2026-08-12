"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, ChatMessagePayload } from "../../lib/realtime/events";
import { PRESENCE_EVENT, type PresenceDetail } from "../presence-tracker";

/** Minimum gap between typing pings while the composer has content. */
const TYPING_PING_MS = 2200;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Visitor-facing chat.
 *
 * Downstream is an SSE stream (`/api/chat/stream`), upstream is a plain POST.
 * The browser's EventSource reconnects on its own after the server closes a
 * stream at its lifetime cap, so there is no manual retry loop here — the one
 * thing we do handle is de-duplicating by message id, because a reconnect
 * replays recent history.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [draft, setDraft] = useState("");
  const [ownerTyping, setOwnerTyping] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  /** True once this visitor has an actual thread — gates the closed-panel poll. */
  const [hasThread, setHasThread] = useState(false);
  /** P11 presence: is the owner behind an admin screen right now? */
  const [ownerOnline, setOwnerOnline] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastTypingPing = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyEvent = useCallback((event: ChatEvent) => {
    switch (event.type) {
      case "ready":
        setMessages(event.messages);
        if (event.messages.length > 0) setHasThread(true);
        break;
      case "message":
        setMessages((current) => {
          if (current.some((m) => m.id === event.message.id)) return current;
          return [...current, event.message];
        });
        setHasThread(true);
        break;
      case "typing": {
        if (event.who !== "OWNER") break;
        // The indicator is driven by a timer rather than by comparing the
        // deadline during render: reading the clock while rendering makes the
        // output depend on *when* React happens to re-render, which is
        // exactly the impurity the compiler rules forbid.
        if (typingTimer.current) clearTimeout(typingTimer.current);
        const remaining = new Date(event.until).getTime() - Date.now();
        if (remaining <= 0) {
          setOwnerTyping(false);
          break;
        }
        setOwnerTyping(true);
        typingTimer.current = setTimeout(() => setOwnerTyping(false), remaining);
        break;
      }
      case "read": {
        const ids = new Set(event.ids);
        setMessages((current) =>
          current.map((m) => (ids.has(m.id) ? { ...m, readAt: event.at } : m)),
        );
        break;
      }
      case "presence":
        setOwnerOnline(event.ownerOnline);
        break;
    }
  }, []);

  // The presence tracker beats whether or not this widget is open, so the
  // launcher can carry a truthful "online" pip before anyone clicks it. The
  // stream's own `presence` event takes over once the panel is open; both write
  // the same state, and the stream is the fresher of the two.
  useEffect(() => {
    const onPresence = (event: Event) => {
      setOwnerOnline((event as CustomEvent<PresenceDetail>).detail.ownerOnline);
    };
    window.addEventListener(PRESENCE_EVENT, onPresence);
    return () => window.removeEventListener(PRESENCE_EVENT, onPresence);
  }, []);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    },
    [],
  );

  // Only hold a stream open while the panel is open. A widget that nobody has
  // clicked shouldn't cost every visitor a long-lived connection.
  useEffect(() => {
    if (!open) return;

    const source = new EventSource("/api/chat/stream");
    const onEvent = (raw: MessageEvent) => {
      try {
        applyEvent(JSON.parse(raw.data) as ChatEvent);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    source.addEventListener("open", () => setConnected(true));
    for (const name of ["ready", "message", "typing", "read", "presence"] as const) {
      source.addEventListener(name, onEvent as EventListener);
    }
    source.addEventListener("error", () => setConnected(false));

    return () => {
      source.close();
      setConnected(false);
    };
  }, [open, applyEvent]);

  // Acknowledge the owner's messages once the panel is actually open.
  useEffect(() => {
    if (!open) return;
    const hasUnreadFromOwner = messages.some((m) => m.author === "OWNER" && !m.readAt);
    if (!hasUnreadFromOwner) return;

    fetch("/api/chat/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  }, [open, messages]);

  // Unread badge while the panel is shut.
  //
  // No SSE stream runs when the widget is closed — holding a connection open
  // for every visitor who never clicks it would be wasteful — so the badge is
  // fed by a slow poll instead, and only for visitors who actually have a
  // thread. Someone who never opens the widget costs zero requests.
  useEffect(() => {
    if (open || !hasThread) return;

    const check = async () => {
      try {
        const response = await fetch("/api/chat/messages");
        const json = (await response.json()) as { messages: ChatMessagePayload[] };
        setUnread(json.messages.filter((m) => m.author === "OWNER" && !m.readAt).length);
      } catch {
        /* offline or mid-deploy — the badge simply doesn't update */
      }
    };

    void check();
    const timer = setInterval(check, 45000);
    return () => clearInterval(timer);
  }, [open, hasThread]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, ownerTyping]);

  const pingTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingPing.current < TYPING_PING_MS) return;
    lastTypingPing.current = now;
    fetch("/api/chat/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  }, []);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setDraft("");
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = (await response.json()) as { message?: ChatMessagePayload; error?: string };
      if (json.message) {
        // Merge immediately rather than waiting for the stream — the local
        // echo is what makes the send feel instant. The id check in
        // applyEvent stops the streamed copy from duplicating it.
        setMessages((current) =>
          current.some((m) => m.id === json.message!.id) ? current : [...current, json.message!],
        );
      } else if (json.error) {
        setDraft(body);
      }
    } catch {
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-widget">
      {open && (
        <section className="chat-panel" aria-label="Chat with Shivam">
          <header className="chat-panel-head">
            <div>
              <strong>Chat with Shivam</strong>
              {/* Two different facts, and conflating them would be a lie: the
                  transport being up says nothing about whether anyone is
                  reading. Once connected, the useful line is the second one. */}
              <span className={ownerOnline ? "chat-status is-live" : "chat-status"}>
                {!connected
                  ? "connecting…"
                  : ownerOnline
                    ? "Shivam is online"
                    : "Away — replies land in your inbox"}
              </span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat">
              ✕
            </button>
          </header>

          <div className="chat-messages" ref={listRef}>
            {messages.length === 0 && (
              <p className="chat-empty">
                Ask about a role, a system design question, or anything on the site. Replies land
                here and by email if I&apos;m away.
              </p>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`chat-bubble chat-bubble-${message.author.toLowerCase()}`}
              >
                <p>{message.body}</p>
                <footer>
                  <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
                  {message.author === "VISITOR" && (
                    <span
                      className={message.readAt ? "chat-ticks is-read" : "chat-ticks"}
                      title={message.readAt ? "Read" : "Delivered"}
                      aria-label={message.readAt ? "Read" : "Delivered"}
                    >
                      {message.readAt ? "✓✓" : "✓"}
                    </span>
                  )}
                </footer>
              </article>
            ))}
            {ownerTyping && (
              <div className="chat-typing" aria-live="polite">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          <form className="chat-composer" onSubmit={send}>
            <label htmlFor="chat-draft" className="chat-visually-hidden">
              Message
            </label>
            <textarea
              id="chat-draft"
              value={draft}
              rows={1}
              placeholder="Type a message…"
              onChange={(event) => {
                setDraft(event.target.value);
                if (event.target.value.trim()) pingTyping();
              }}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks the line — the convention
                // every chat client has trained people to expect.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(event);
                }
              }}
            />
            <button type="submit" disabled={sending || !draft.trim()} data-ripple>
              {sending ? "…" : "Send"}
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className="chat-launcher"
        onClick={() => {
          setOpen((value) => !value);
          // Clearing here rather than in an effect keeps the reset tied to the
          // user's action instead of triggering a cascading render.
          setUnread(0);
        }}
        aria-expanded={open}
        aria-label={open ? "Close chat" : "Open chat"}
        data-magnetic
      >
        {open ? "✕" : "💬"}
        {!open && unread > 0 && <i className="chat-badge">{unread}</i>}
        {/* The pip is suppressed while an unread badge is showing — two dots in
            the same corner read as one broken one. */}
        {!open && unread === 0 && ownerOnline && (
          <i className="chat-online-pip" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
