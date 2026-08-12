"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, ChatMessagePayload } from "../../lib/realtime/events";
import "./admin-chat.css";

export interface ConversationSummary {
  id: string;
  label: string;
  email: string | null;
  lastMessageAt: string;
  unread: number;
}

const TYPING_PING_MS = 2200;

/**
 * Owner side of the chat.
 *
 * Mirrors the visitor widget's transport (SSE down, POST up) but streams a
 * chosen thread via ?conversationId=. The thread list itself is rendered
 * server-side and passed in — it only changes when a new conversation starts,
 * which doesn't warrant a second live stream.
 */
export function ChatConsole({ conversations }: { conversations: ConversationSummary[] }) {
  const [activeId, setActiveId] = useState(conversations[0]?.id ?? null);
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [draft, setDraft] = useState("");
  const [visitorTyping, setVisitorTyping] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastTypingPing = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyEvent = useCallback((event: ChatEvent) => {
    switch (event.type) {
      case "ready":
        setMessages(event.messages);
        break;
      case "message":
        setMessages((current) =>
          current.some((m) => m.id === event.message.id) ? current : [...current, event.message],
        );
        break;
      case "typing": {
        if (event.who !== "VISITOR") break;
        // Timer-driven rather than compared against the clock during render —
        // see the same note in the visitor widget.
        if (typingTimer.current) clearTimeout(typingTimer.current);
        const remaining = new Date(event.until).getTime() - Date.now();
        if (remaining <= 0) {
          setVisitorTyping(false);
          break;
        }
        setVisitorTyping(true);
        typingTimer.current = setTimeout(() => setVisitorTyping(false), remaining);
        break;
      }
      case "read": {
        const ids = new Set(event.ids);
        setMessages((current) =>
          current.map((m) => (ids.has(m.id) ? { ...m, readAt: event.at } : m)),
        );
        break;
      }
    }
  }, []);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!activeId) return;

    const source = new EventSource(`/api/chat/stream?conversationId=${activeId}`);
    const onEvent = (raw: MessageEvent) => {
      try {
        applyEvent(JSON.parse(raw.data) as ChatEvent);
      } catch {
        /* ignore a malformed frame */
      }
    };
    source.addEventListener("open", () => setConnected(true));
    for (const name of ["ready", "message", "typing", "read"] as const) {
      source.addEventListener(name, onEvent as EventListener);
    }
    source.addEventListener("error", () => setConnected(false));

    return () => {
      source.close();
      setConnected(false);
    };
  }, [activeId, applyEvent]);

  // Acknowledge the visitor's messages so their ticks turn read.
  useEffect(() => {
    if (!activeId) return;
    if (!messages.some((m) => m.author === "VISITOR" && !m.readAt)) return;
    fetch("/api/chat/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: activeId }),
    }).catch(() => undefined);
  }, [activeId, messages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !activeId || sending) return;

    setSending(true);
    setDraft("");
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, conversationId: activeId }),
      });
      const json = (await response.json()) as { message?: ChatMessagePayload };
      if (json.message) {
        setMessages((current) =>
          current.some((m) => m.id === json.message!.id) ? current : [...current, json.message!],
        );
      } else {
        setDraft(body);
      }
    } catch {
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  if (conversations.length === 0) {
    return (
      <p className="text-app-muted border-app-line rounded-2xl border py-10 text-center">
        No conversations yet. They appear here the moment a visitor sends a first message.
      </p>
    );
  }

  return (
    <div className="admin-chat">
      <aside className="admin-chat-list">
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            onClick={() => {
              setActiveId(conversation.id);
              // Cleared here rather than in the stream effect: doing it in an
              // effect would be a cascading render, and the previous thread
              // would flash while the new one loads either way.
              setMessages([]);
              setVisitorTyping(false);
            }}
            className={conversation.id === activeId ? "is-active" : ""}
          >
            <strong>{conversation.label}</strong>
            {conversation.email && <small>{conversation.email}</small>}
            <span>
              {new Date(conversation.lastMessageAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {conversation.unread > 0 && <i>{conversation.unread}</i>}
          </button>
        ))}
      </aside>

      <section className="admin-chat-thread">
        <header>
          <strong>{conversations.find((c) => c.id === activeId)?.label ?? "Conversation"}</strong>
          <span className={connected ? "chat-status is-live" : "chat-status"}>
            {connected ? "connected" : "connecting…"}
          </span>
        </header>

        <div className="chat-messages" ref={listRef}>
          {messages.map((message) => (
            <article
              key={message.id}
              className={`chat-bubble chat-bubble-${message.author.toLowerCase()}`}
            >
              <p>{message.body}</p>
              <footer>
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {message.author === "OWNER" && (
                  <span className={message.readAt ? "chat-ticks is-read" : "chat-ticks"}>
                    {message.readAt ? "✓✓" : "✓"}
                  </span>
                )}
              </footer>
            </article>
          ))}
          {visitorTyping && (
            <div className="chat-typing" aria-live="polite">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>

        <form className="chat-composer" onSubmit={send}>
          <label htmlFor="admin-chat-draft" className="chat-visually-hidden">
            Reply
          </label>
          <textarea
            id="admin-chat-draft"
            rows={1}
            value={draft}
            placeholder="Reply…"
            onChange={(event) => {
              setDraft(event.target.value);
              const now = Date.now();
              if (event.target.value.trim() && now - lastTypingPing.current > TYPING_PING_MS) {
                lastTypingPing.current = now;
                fetch("/api/chat/typing", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ conversationId: activeId }),
                }).catch(() => undefined);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(event);
              }
            }}
          />
          <button type="submit" disabled={sending || !draft.trim()} data-ripple>
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
