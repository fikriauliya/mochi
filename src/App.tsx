import * as React from "react";
import { ProfileRail } from "./components/ProfileRail";
import { ChatHeader } from "./components/ChatHeader";
import { EmptyState } from "./components/EmptyState";
import { Composer } from "./components/Composer";
import { MessageBubble, type Message } from "./components/MessageBubble";
import { TypingBubble } from "./components/TypingBubble";
import { FAMILY, type FamilyId } from "./lib/family";
import { fakeTypingDelay, mochiReply } from "./lib/mockReplies";
import "./index.css";

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export function App() {
  const [activeId, setActiveId] = React.useState<FamilyId>("aira");
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [typing, setTyping] = React.useState(false);
  const [railOpen, setRailOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const member = FAMILY[activeId];

  // Close drawer on Escape, and when crossing the md breakpoint upward.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailOpen(false);
    };
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => mq.matches && setRailOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onChange);
    };
  }, []);

  // Auto-scroll on new messages / typing change
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  const reset = React.useCallback(() => {
    setMessages([]);
    setTyping(false);
  }, []);

  // Switching profile clears the local thread (keeps the demo simple).
  const handleSelect = React.useCallback((id: FamilyId) => {
    setActiveId(id);
    setMessages([]);
    setTyping(false);
  }, []);

  const send = React.useCallback(
    (text: string) => {
      const userMsg: Message = {
        id: makeId(),
        authorId: activeId,
        text,
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      const reply = mochiReply(text, FAMILY[activeId]);
      setTyping(true);

      const timeout = setTimeout(() => {
        const replyMsg: Message = {
          id: makeId(),
          authorId: "mochi",
          text: reply,
          ts: Date.now(),
        };
        setMessages((prev) => [...prev, replyMsg]);
        setTyping(false);
      }, fakeTypingDelay(reply));

      return () => clearTimeout(timeout);
    },
    [activeId],
  );

  const hasMessages = messages.length > 0 || typing;

  return (
    <div className="h-dvh w-screen flex overflow-hidden">
      <ProfileRail
        active={activeId}
        onSelect={handleSelect}
        onNewChat={reset}
        mobileOpen={railOpen}
        onMobileClose={() => setRailOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 relative">
        <ChatHeader
          member={member}
          onClear={reset}
          hasMessages={hasMessages}
          onOpenRail={() => setRailOpen(true)}
        />

        {!hasMessages ? (
          <EmptyState member={member} onPick={(prompt) => send(prompt)} />
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-4 sm:space-y-5">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  member={msg.authorId !== "mochi" ? FAMILY[msg.authorId as FamilyId] : undefined}
                />
              ))}
              {typing && <TypingBubble />}
            </div>
          </div>
        )}

        <Composer member={member} onSend={send} disabled={typing} />
      </main>
    </div>
  );
}

export default App;
