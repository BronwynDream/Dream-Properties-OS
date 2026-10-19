// Scan & file (Arc E3, 2026-10-19): the image work behind "Scan pages".
// Everything runs in the agent's browser — photos never leave the phone until
// they are a finished PDF. Pure canvas maths, no libraries beyond pdf-lib.
//
//   loadPhoto      → photo file → canvas, downscaled (phones shoot 12 MP+)
//   detectCorners  → best guess at the page's four corners (white paper on a
//                    darker surface); falls back to a gentle inset
//   flatten        → perspective-correct the quad to a straight rectangle,
//                    then optionally "clean" it (evens out shadows, whitens
//                    the paper, keeps ink and signatures as dark grey)
//   pagesToPdf     → one PDF, one page per scan

export type Pt = [number, number]; // normalised 0..1 of the source image
export type Corners = [Pt, Pt, Pt, Pt]; // top-left, top-right, bottom-right, bottom-left
export type ScanMode = "clean" | "colour";

const SOURCE_MAX = 2400;
const OUTPUT_MAX = 2000;

export const DEFAULT_CORNERS: Corners = [
  [0.06, 0.06],
  [0.94, 0.06],
  [0.94, 0.94],
  [0.06, 0.94],
];

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Photo → canvas, long side ≤ 2400 px. Browsers apply EXIF rotation to <img>. */
export async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That photo couldn't be opened."));
      i.src = url;
    });
    const k = Math.min(1, SOURCE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = canvas(img.naturalWidth * k, img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Find the page: work on a ~220 px copy, Otsu-threshold the brightness, keep
 * the largest bright blob, and take its extreme points as corners. Good for
 * the usual case (a white page on a desk or car seat). Anything doubtful —
 * blob too small, or the whole frame — returns the default inset, and the
 * agent drags the corners.
 */
export function detectCorners(src: HTMLCanvasElement): Corners {
  try {
    const k = 220 / Math.max(src.width, src.height);
    const w = Math.max(8, Math.round(src.width * k));
    const h = Math.max(8, Math.round(src.height * k));
    const c = canvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const lum = new Uint8Array(w * h);
    const hist = new Array(256).fill(0);
    for (let i = 0; i < w * h; i++) {
      const v = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
      lum[i] = v;
      hist[lum[i]]++;
    }
    // Otsu
    const total = w * h;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, thr = 160;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    // Largest bright connected blob (4-neighbour flood fill).
    const label = new Int32Array(w * h);
    let bestLabel = 0, bestSize = 0, next = 0;
    const stack: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (label[i] || lum[i] <= thr) continue;
      next++;
      let size = 0;
      stack.push(i);
      label[i] = next;
      while (stack.length) {
        const p = stack.pop()!;
        size++;
        const x = p % w, y = (p - x) / w;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        for (const q of nb) {
          if (q >= 0 && !label[q] && lum[q] > thr) { label[q] = next; stack.push(q); }
        }
      }
      if (size > bestSize) { bestSize = size; bestLabel = next; }
    }
    const frac = bestSize / total;
    if (frac < 0.15 || frac > 0.97) return DEFAULT_CORNERS;
    let tl = [0, 0, Infinity], tr = [0, 0, -Infinity], br = [0, 0, -Infinity], bl = [0, 0, Infinity];
    for (let i = 0; i < w * h; i++) {
      if (label[i] !== bestLabel) continue;
      const x = i % w, y = (i - x) / w;
      if (x + y < tl[2]) tl = [x, y, x + y];
      if (x + y > br[2]) br = [x, y, x + y];
      if (x - y > tr[2]) tr = [x, y, x - y];
      if (x - y < bl[2]) bl = [x, y, x - y];
    }
    const n = (p: number[]): Pt => [Math.min(1, Math.max(0, (p[0] + 0.5) / w)), Math.min(1, Math.max(0, (p[1] + 0.5) / h))];
    const out: Corners = [n(tl), n(tr), n(br), n(bl)];
    // Reject degenerate shapes (a sliver, or corners that collapsed together).
    const area = Math.abs(polyArea(out));
    if (area < 0.12) return DEFAULT_CORNERS;
    return out;
  } catch {
    return DEFAULT_CORNERS;
  }
}

function polyArea(q: Corners) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Unit square → quad (Heckbert). Returns (u,v) → source pixel. */
function squareToQuad(q: [Pt, Pt, Pt, Pt]) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; h = 0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return (u: number, v: number): Pt => {
    const z = g * u + h * v + 1;
    return [(a * u + b * v + c) / z, (d * u + e * v + f) / z];
  };
}

/** Straighten the page, rotate by quarter turns, optionally clean it. */
export function flatten(src: HTMLCanvasElement, corners: Corners, rotate: number, mode: ScanMode): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const px = corners.map(([x, y]) => [x * W, y * H] as Pt) as [Pt, Pt, Pt, Pt];
  let ow = Math.max(dist(px[0], px[1]), dist(px[3], px[2]));
  let oh = Math.max(dist(px[0], px[3]), dist(px[1], px[2]));
  const k = Math.min(1, OUTPUT_MAX / Math.max(ow, oh));
  ow = Math.max(16, Math.round(ow * k));
  oh = Math.max(16, Math.round(oh * k));

  const sd = src.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const out = canvas(ow, oh);
  const octx = out.getContext("2d", { willReadFrequently: true })!;
  const od = octx.createImageData(ow, oh);
  const o = od.data;
  const map = squareToQuad(px);
  for (let j = 0; j < oh; j++) {
    const v = (j + 0.5) / oh;
    for (let i = 0; i < ow; i++) {
      const [sx, sy] = map((i + 0.5) / ow, v);
      // bilinear
      const x = Math.min(W - 1.001, Math.max(0, sx - 0.5));
      const y = Math.min(H - 1.001, Math.max(0, sy - 0.5));
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const p00 = (y0 * W + x0) * 4, p10 = p00 + 4, p01 = p00 + W * 4, p11 = p01 + 4;
      const t = (j * ow + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = sd[p00 + ch] + (sd[p10 + ch] - sd[p00 + ch]) * fx;
        const bot = sd[p01 + ch] + (sd[p11 + ch] - sd[p01 + ch]) * fx;
        o[t + ch] = top + (bot - top) * fy;
      }
      o[t + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  if (mode === "clean") clean(out);
  return rotateCanvas(out, rotate);
}

/**
 * Even out shadows and whiten the paper: estimate the paper brightness with a
 * coarse max-filter (ink is thin, paper is everywhere), divide it out, then
 * stretch. Output is greyscale, not hard black-and-white, so signatures and
 * stamps stay legible.
 */
function clean(c: HTMLCanvasElement) {
  const w = c.width, h = c.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // Background at 1/16 scale, dilated twice.
  const bw = Math.max(4, Math.round(w / 16)), bh = Math.max(4, Math.round(h / 16));
  const small = canvas(bw, bh);
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(c, 0, 0, bw, bh);
  const sd = sctx.getImageData(0, 0, bw, bh);
  let bg = new Float32Array(bw * bh);
  for (let i = 0; i < bw * bh; i++) bg[i] = (sd.data[i * 4] * 299 + sd.data[i * 4 + 1] * 587 + sd.data[i * 4 + 2] * 114) / 1000;
  for (let pass = 0; pass < 2; pass++) {
    const nb = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(bw - 1, Math.max(0, x + dx)), yy = Math.min(bh - 1, Math.max(0, y + dy));
            m = Math.max(m, bg[yy * bw + xx]);
          }
        nb[y * bw + x] = m;
      }
    bg = nb;
  }
  for (let y = 0; y < h; y++) {
    const gy = Math.min(bh - 1.001, Math.max(0, ((y + 0.5) / h) * bh - 0.5));
    const y0 = gy | 0, fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(bw - 1.001, Math.max(0, ((x + 0.5) / w) * bw - 0.5));
      const x0 = gx | 0, fx = gx - x0;
      const a = bg[y0 * bw + x0], b = bg[y0 * bw + x0 + 1], cc = bg[(y0 + 1) * bw + x0], dd = bg[(y0 + 1) * bw + x0 + 1];
      const back = Math.max(40, a + (b - a) * fx + (cc + (dd - cc) * fx - (a + (b - a) * fx)) * fy);
      const p = (y * w + x) * 4;
      const L = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
      let v = L / back; // ~1 on paper, lower on ink
      v = (v - 0.5) / (0.9 - 0.5);
      v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, 1.4);
      const g = v * 255;
      d[p] = d[p + 1] = d[p + 2] = g;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function rotateCanvas(c: HTMLCanvasElement, quarter: number) {
  const q = ((quarter % 4) + 4) % 4;
  if (!q) return c;
  const out = q % 2 ? canvas(c.height, c.width) : canvas(c.width, c.height);
  const ctx = out.getContext("2d")!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

export function toJpeg(c: HTMLCanvasElement, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the page."))), "image/jpeg", quality),
  );
}

/** One PDF, A4 width, each page at its own aspect ratio. */
export async function pagesToPdf(pages: HTMLCanvasElement[], title: string): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer("Dream OS");
  pdf.setCreator("Dream OS — Scan pages");
  const A4W = 595.28;
  for (const c of pages) {
    const jpg = await pdf.embedJpg(new Uint8Array(await (await toJpeg(c)).arrayBuffer()));
    const pw = A4W, ph = (A4W * c.height) / c.width;
    const page = pdf.addPage([pw, ph]);
    page.drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
