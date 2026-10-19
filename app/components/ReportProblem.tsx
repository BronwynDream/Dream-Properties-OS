"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reportProblem } from "@/app/feedback/actions";
import { installErrorCapture, pageContext } from "@/lib/clientErrors";

// "Something's not right" (2026-10-19). One line from the agent; the page,
// their name, the time, the device and any recent errors go with it.
export default function ReportProblem() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    installErrorCapture();
  }, []);

  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setState("sending");
    const res = await reportProblem({ message: text, ...pageContext() });
    if (!res.ok) {
      setErr(res.error);
      setState("idle");
      return;
    }
    setState("sent");
    setText("");
  }

  function show() {
    setState("idle");
    setErr(null);
    setOpen(true);
  }

  return (
    <>
      <button type="button" className="topbar-report" onClick={show} aria-label="Report a problem with this page">
        <span aria-hidden="true" className="topbar-report-icon">!</span>
        <span className="topbar-report-text">Report a problem</span>
      </button>
      {open && createPortal(
        <div className="report-scrim" onClick={() => setOpen(false)}>
          <div className="report" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={(e) => e.stopPropagation()}>
            {state === "sent" ? (
              <>
                <h2 id="report-title">Thanks — sent</h2>
                <p className="report-sub">Simon will see it with the page you were on. Carry on; nothing else to do.</p>
                <div className="report-actions">
                  <button type="button" className="btn-primary" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={send}>
                <h2 id="report-title">Something&apos;s not right?</h2>
                <p className="report-sub">Say in a line what you expected and what happened. We&apos;ll know which page you&apos;re on.</p>
                <textarea
                  ref={box}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder="e.g. I saved the seller's phone number but it's not showing"
                  aria-label="What went wrong"
                />
                {err && <p className="adddocs-err" role="alert">{err}</p>}
                <div className="report-actions">
                  <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={!text.trim() || state === "sending"}>
                    {state === "sending" ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
