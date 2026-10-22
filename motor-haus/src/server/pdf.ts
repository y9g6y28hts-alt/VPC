import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { degrees, PDFDocument, PDFFont, PDFImage, PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { DocModel } from "./documents";

// PDF institucional A4 generado desde el mismo modelo que la vista HTML.
// Fuentes estándar (WinAnsi): los caracteres no representables se sustituyen.

const A4: [number, number] = [595.28, 841.89];
const M = 44;
const INK = rgb(0.07, 0.07, 0.08);
const MUTED = rgb(0.42, 0.43, 0.46);
const LINE = rgb(0.82, 0.82, 0.8);
const BRAND = rgb(5 / 255, 4 / 255, 134 / 255); // azul del logo
const WARN = rgb(0.62, 0.42, 0.08);

// Escudo de la marca; si no está disponible el documento se emite solo con el nombre.
let logoBytes: Promise<Uint8Array | null> | undefined;
function loadLogo() {
  logoBytes ??= readFile(path.join(process.cwd(), "public/brand/motor-haus-logo.png")).then((b) => new Uint8Array(b), () => null);
  return logoBytes;
}

function safe(font: PDFFont, text: string): string {
  const replaced = text.replace(/[‐‑‒–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/₲/g, "Gs.").replace(/→/g, "->").replace(/−/g, "-");
  let out = "";
  for (const ch of replaced) {
    try { font.encodeText(ch); out += ch; } catch { out += "?"; }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = safe(font, text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function renderPdf(model: DocModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${model.title} ${model.number}`);
  pdf.setProducer("Motor Haus");
  pdf.setCreator("Motor Haus");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoPng = await loadLogo();
  const logo: PDFImage | null = logoPng ? await pdf.embedPng(logoPng) : null;
  const width = A4[0] - 2 * M;
  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;

  const text = (t: string, x: number, size = 9, font = regular, color = INK) => page.drawText(safe(font, t), { x, y, size, font, color });
  const header = () => {
    page.drawRectangle({ x: M, y: A4[1] - M + 6, width, height: 1.2, color: BRAND });
    y = A4[1] - M - 8;
    if (logo) {
      page.drawImage(logo, { x: M, y: y - 8, width: 22, height: 22 });
      text("MOTOR HAUS", M + 28, 8, bold, BRAND);
    } else text("MOTOR HAUS", M, 8, bold, BRAND);
    const right = safe(regular, `${model.number}`);
    page.drawText(right, { x: M + width - regular.widthOfTextAtSize(right, 8), y, size: 8, font: regular, color: MUTED });
    y -= logo ? 22 : 12;
    if (model.isDemo) {
      page.drawText("DATOS DE DEMOSTRACION - DOCUMENTO SIN VALIDEZ", { x: M + 30, y: 250, size: 22, font: bold, color: rgb(0.78, 0.78, 0.9), rotate: degrees(30), opacity: 0.35 });
    }
  };
  const ensure = (h: number) => {
    if (y - h < M + 30) { page = pdf.addPage(A4); header(); y -= 6; }
  };
  header();

  // Encabezado del documento
  y -= 8;
  text(model.title, M, 16, bold);
  y -= 15;
  text(model.orgName, M, 9, bold, MUTED);
  y -= 11;
  for (const l of wrap(regular, model.orgLine, 8, width)) { text(l, M, 8, regular, MUTED); y -= 10; }
  text(`Emitido: ${new Date(model.issuedAt).toLocaleString("es-PY", { timeZone: "America/Asuncion" })}  ·  Estado: ${model.status === "issued" ? "vigente" : model.status}`, M, 8, regular, MUTED);
  y -= 16;

  for (const b of model.blocks) {
    if (b.heading) {
      ensure(30);
      y -= 4;
      text(b.heading.toUpperCase(), M, 8, bold, BRAND);
      y -= 5;
      page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.5, color: LINE });
      y -= 12;
    }
    if (b.type === "kv") {
      const colW = width / 2;
      for (let i = 0; i < b.pairs.length; i += 2) {
        ensure(26);
        for (let j = 0; j < 2 && i + j < b.pairs.length; j++) {
          const [k, v] = b.pairs[i + j];
          const x = M + j * colW;
          page.drawText(safe(regular, k), { x, y, size: 7.5, font: regular, color: MUTED });
          const lines = wrap(bold, v, 9, colW - 12);
          lines.slice(0, 2).forEach((l, li) => page.drawText(l, { x, y: y - 11 - li * 10, size: 9, font: bold, color: INK }));
        }
        y -= 28;
      }
      y -= 4;
    } else if (b.type === "text") {
      for (const l of wrap(regular, b.text, 8.5, width)) { ensure(12); text(l, M, 8.5, regular, b.tone === "warning" ? WARN : b.tone === "muted" ? MUTED : INK); y -= 11; }
      y -= 6;
    } else {
      const weights = b.columns.map((c) => c.width ?? 1);
      const total = weights.reduce((a, w) => a + w, 0);
      const xs: number[] = [];
      let acc = M;
      weights.forEach((w) => { xs.push(acc); acc += (w / total) * width; });
      const colWidth = (i: number) => (weights[i] / total) * width;
      const drawRow = (cells: string[], font: PDFFont, color = INK, size = 8) => {
        cells.forEach((cell, i) => {
          const s = safe(font, cell);
          let t = s;
          while (t.length > 1 && font.widthOfTextAtSize(t, size) > colWidth(i) - 6) t = t.slice(0, -2) + "…";
          if (font.widthOfTextAtSize(t, size) > colWidth(i) - 6) t = "";
          const w = font.widthOfTextAtSize(t, size);
          const x = b.columns[i]?.align === "right" ? xs[i] + colWidth(i) - w - 3 : xs[i] + 2;
          page.drawText(t, { x, y, size, font, color });
        });
      };
      const head = () => { ensure(16); drawRow(b.columns.map((c) => c.label), bold, MUTED, 7.5); y -= 4; page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.4, color: LINE }); y -= 10; };
      head();
      for (const r of b.rows) {
        if (y - 12 < M + 30) { page = pdf.addPage(A4); header(); y -= 6; head(); }
        drawRow(r, regular);
        y -= 12;
      }
      if (b.footer) { drawRow(b.footer, bold); y -= 12; }
      y -= 8;
    }
  }

  // Aviso legal y verificación
  ensure(60);
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.5, color: LINE });
  y -= 12;
  for (const l of wrap(regular, model.notice, 7.5, width)) { ensure(10); text(l, M, 7.5, regular, MUTED); y -= 9.5; }
  y -= 4;
  text(`Verificación de integridad: ${model.checksum}${model.integrityOk ? "" : "  (NO COINCIDE)"}`, M, 6.5, regular, MUTED);

  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: A4[0] - M - 20, y: M - 18, size: 7, font: regular, color: MUTED }));
  return pdf.save();
}
