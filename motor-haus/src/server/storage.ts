import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { DomainError } from "./errors";

// Almacenamiento privado de archivos.
//  · local: directorio fuera de /public (MH_STORAGE_DIR); se sirve solo por una ruta autorizada.
//  · supabase: bucket privado de Supabase Storage con la clave de servicio (solo servidor).
const BUCKET = process.env.MH_STORAGE_BUCKET ?? "unit-media";

function mode(): "local" | "supabase" {
  return process.env.MH_STORAGE_MODE === "supabase" ? "supabase" : "local";
}

function localPath(key: string): string {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) throw new DomainError("VALIDATION", "Ruta de archivo inválida");
  return path.join(process.env.MH_STORAGE_DIR ?? path.join(process.cwd(), "storage"), key);
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new DomainError("INTERNAL", "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY para el almacenamiento.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  if (mode() === "supabase") {
    const { error } = await supabaseAdmin().storage.from(BUCKET).upload(key, data, { contentType, upsert: false });
    if (error) throw new DomainError("INTERNAL", `No se pudo guardar el archivo: ${error.message}`);
    return;
  }
  const p = localPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data, { flag: "wx" });
}

export async function getObject(key: string): Promise<Buffer> {
  if (mode() === "supabase") {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(key);
    if (error || !data) throw new DomainError("NOT_FOUND", "Archivo no disponible");
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(localPath(key));
}

/** Detecta el tipo real por la firma del archivo (no se confía en la extensión ni en el MIME del navegador). */
export function sniffImage(buf: Buffer): { ext: "jpg" | "png" | "webp"; type: string } | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}
