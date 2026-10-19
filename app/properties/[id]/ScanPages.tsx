"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CORNERS, detectCorners, flatten, loadPhoto, pagesToPdf, type Corners, type ScanMode } from "@/lib/scan";

// Scan pages (Arc E3, 2026-10-19). Photograph a signed mandate, an ID or a
// plan page by page; each photo is straightened to the page edges and
// cleaned up, and the lot becomes one PDF that AddDocuments files on the
// deal. All of it happens on the phone — nothing uploads until "Add to
// documents".

type Page = {
  id: string;
  src: HTMLCanvasElement;
  preview: string; // object URL of the source, for the corner editor
  corners: Corners;
  rotate: number;
  mode: ScanMode;
  result: HTMLCanvasElement | null;
  thumb: string | null;
};

const LABELS = ["top-left", "top-right", "bottom-right", "bottom-left"];

function canvasUrl(c: HTMLCanvasElement, max = 1200): Promise<string> {
  const k = Math.min(1, max / Math.max(c.width, c.height));
  const t = document.createElement("canvas");
  t.width = Math.round(c.width * k);
  t.height = Math.round(c.height * k);
  t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
  return new Promise((resolve) => t.toBlob((b) => resolve(b ? URL.createObjectURL(b) : ""), "image/jpeg", 0.8));
}

export default function ScanPages({ onDone, onClose }: { onDone: (file: File) => void; onClose: () => void }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  // Free object URLs and lock the page behind the sheet.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const list = urls.current;
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      list.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [onClose]);

  const track = (u: string) => {
    if (u) urls.current.push(u);
    return u;
  };

  async function addPhotos(list: FileList | null) {
    if (!list?.length) return;
    setErr(null);
    setBusy("Finding the page edges…");
    try {
      const added: Page[] = [];
      for (const f of Array.from(list)) {
        const src = await loadPhoto(f);
        added.push({
          id: crypto.randomUUID(),
          src,
          preview: track(await canvasUrl(src)),
          corners: detectCorners(src),
          rotate: 0,
          mode: "clean",
          result: null,
          thumb: null,
        });
      }
      const first = pages.length;
      setPages((p) => [...p, ...added]);
      setEditing(first); // open the first new page
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That photo couldn't be opened.");
    } finally {
      setBusy(null);
      if (camera.current) camera.current.value = "";
    }
  }

  const update = useCallback((i: number, patch: Partial<Page>) => {
    setPages((all) => all.map((p, j) => (j === i ? { ...p, ...patch, result: null, thumb: null } : p)));
  }, []);

  async function render(p: Page): Promise<Page> {
    if (p.result && p.thumb) return p;
    const result = flatten(p.src, p.corners, p.rotate, p.mode);
    return { ...p, result, thumb: track(await canvasUrl(result, 480)) };
  }

  async function finishEdit() {
    if (editing == null) return;
    setBusy("Straightening…");
    await new Promise((r) => setTimeout(r, 20)); // let the label paint
    try {
      const done = await render(pages[editing]);
      setPages((all) => all.map((p, j) => (j === editing ? done : p)));
      setEditing(null);
    } catch {
      setErr("Couldn't straighten that page. Try again, or retake it.");
    } finally {
      setBusy(null);
    }
  }

  async function makePdf() {
    setErr(null);
    setBusy("Making the PDF…");
    await new Promise((r) => setTimeout(r, 20));
    try {
      const ready: Page[] = [];
      for (const p of pages) ready.push(await render(p));
      setPages(ready);
      const stamp = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const name = `Scan ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}.pdf`;
      const blob = await pagesToPdf(ready.map((p) => p.result!), name.replace(/\.pdf$/, ""));
      onDone(new File([blob], name, { type: "application/pdf" }));
    } catch {
      setErr("Couldn't make the PDF. Try again with fewer pages.");
    } finally {
      setBusy(null);
    }
  }

  const page = editing != null ? pages[editing] : null;

  return (
    <div className="scan" role="dialog" aria-modal="true" aria-label="Scan pages">
      <header className="scan-head">
        <button type="button" className="scan-link" onClick={onClose} disabled={!!busy}>
          Cancel
        </button>
        <h2>{page ? `Page ${editing! + 1}` : pages.length ? `${pages.length} ${pages.length === 1 ? "page" : "pages"}` : "Scan pages"}</h2>
        <span className="scan-head-gap" />
      </header>

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => addPhotos(e.target.files)}
      />

      {page ? (
        <>
          <CornerEditor page={page} onChange={(corners) => update(editing!, { corners })} />
          <p className="scan-hint">Drag the four dots to the corners of the page.</p>
          <div className="scan-tools">
            <button type="button" className="btn-secondary" onClick={() => update(editing!, { rotate: page.rotate + 1 })} disabled={!!busy}>
              Rotate
            </button>
            <div className="scan-seg" role="group" aria-label="Look">
              <button type="button" className={page.mode === "clean" ? "on" : ""} aria-pressed={page.mode === "clean"} onClick={() => update(editing!, { mode: "clean" })}>
                Clean
              </button>
              <button type="button" className={page.mode === "colour" ? "on" : ""} aria-pressed={page.mode === "colour"} onClick={() => update(editing!, { mode: "colour" })}>
                Colour
              </button>
            </div>
            <button type="button" className="btn-secondary" onClick={() => update(editing!, { corners: DEFAULT_CORNERS })} disabled={!!busy}>
              Reset corners
            </button>
            <button
              type="button"
              className="scan-link scan-danger"
              onClick={() => {
                setPages((all) => all.filter((_, j) => j !== editing));
                setEditing(null);
              }}
              disabled={!!busy}
            >
              Delete page
            </button>
          </div>
          <footer className="scan-foot">
            <button type="button" className="btn-primary" onClick={finishEdit} disabled={!!busy}>
              {busy ?? "Done"}
            </button>
          </footer>
        </>
      ) : (
        <>
          {pages.length === 0 ? (
            <div className="scan-empty">
              <p>Lay the page flat in good light, fill the screen with it, and take the photo. You can add as many pages as the document has.</p>
              <button type="button" className="btn-primary" onClick={() => camera.current?.click()} disabled={!!busy}>
                {busy ?? "Photograph page 1"}
              </button>
            </div>
          ) : (
            <ol className="scan-pages" role="list">
              {pages.map((p, i) => (
                <li key={p.id}>
                  <button type="button" className="scan-thumb" onClick={() => setEditing(i)} aria-label={`Adjust page ${i + 1}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb ?? p.preview} alt="" />
                    <span>Page {i + 1}</span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className="scan-thumb scan-add" onClick={() => camera.current?.click()} disabled={!!busy}>
                  <span aria-hidden="true">+</span>
                  <span>Add page</span>
                </button>
              </li>
            </ol>
          )}
          {err && <p className="adddocs-err" role="alert">{err}</p>}
          {pages.length > 0 && (
            <footer className="scan-foot">
              <button type="button" className="btn-primary" onClick={makePdf} disabled={!!busy}>
                {busy ?? (pages.length === 1 ? "Add as a PDF" : `Add ${pages.length} pages as one PDF`)}
              </button>
            </footer>
          )}
        </>
      )}
    </div>
  );
}

function CornerEditor({ page, onChange }: { page: Page; onChange: (c: Corners) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const c = page.corners;

  function move(i: number, clientX: number, clientY: number) {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    const next = c.map((p, j) => (j === i ? [x, y] : p)) as Corners;
    onChange(next);
  }

  function nudge(i: number, e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.02 : 0.005;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    const next = c.map((p, j) => (j === i ? [Math.min(1, Math.max(0, p[0] + m[0])), Math.min(1, Math.max(0, p[1] + m[1]))] : p)) as Corners;
    onChange(next);
  }

  return (
    <div className="scan-stage">
      <div className="scan-frame" ref={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={page.preview} alt="The photographed page" draggable={false} />
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={c.map((p) => p.join(",")).join(" ")} />
        </svg>
        {c.map((p, i) => (
          <button
            key={i}
            type="button"
            className={`scan-handle${drag === i ? " dragging" : ""}`}
            style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
            aria-label={`Move the ${LABELS[i]} corner (arrow keys)`}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDrag(i);
            }}
            onPointerMove={(e) => drag === i && move(i, e.clientX, e.clientY)}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => nudge(i, e)}
          />
        ))}
      </div>
    </div>
  );
}
