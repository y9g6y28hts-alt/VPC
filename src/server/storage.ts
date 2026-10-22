import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { isEmbeddedDemo } from "@/server/db/client";
import { supabaseServer } from "@/server/supabase";

/**
 * Almacenamiento de archivos privados.
 *   - supabase: Supabase Storage (buckets privados; políticas en la migración
 *     *_storage.sql). La descarga usa URL firmadas de 60 segundos.
 *   - local:    sólo desarrollo. Archivos en ./storage-local, servidos por la
 *     app tras verificar el acceso con RLS.
 */

export type Bucket = "documents" | "vehicle-photos";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Uint8Array) => boolean }> = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** Detecta el tipo real por la firma binaria. */
export function sniffType(bytes: Uint8Array, allowed: readonly string[]): { mime: string; ext: string } | null {
  const hit = SIGNATURES.find((s) => allowed.includes(s.mime) && s.test(bytes));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

/** Local en desarrollo (STORAGE_MODE=local) y en la demo autónoma (en /tmp, escribible en Vercel). */
const isLocal = () => isEmbeddedDemo() || process.env.STORAGE_MODE === "local";
const LOCAL_ROOT = isEmbeddedDemo() ? "/tmp/dasilva-storage" : join(process.cwd(), "storage-local");

function localPath(bucket: Bucket, path: string): string {
  const full = normalize(join(LOCAL_ROOT, bucket, path));
  if (!full.startsWith(join(LOCAL_ROOT, bucket))) throw new Error("Ruta inválida");
  return full;
}

export async function putObject(bucket: Bucket, path: string, bytes: Uint8Array, mime: string): Promise<void> {
  if (isLocal()) {
    const full = localPath(bucket, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes, { flag: "wx" });
    return;
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
}

/** Respuesta HTTP con el archivo (local) o redirección a una URL firmada (Supabase). */
export async function objectResponse(bucket: Bucket, path: string, mime: string, filename: string, inline = true): Promise<Response> {
  const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`;
  if (isLocal()) {
    try {
      const data = await readFile(localPath(bucket, path));
      return new Response(new Uint8Array(data), {
        headers: {
          "content-type": mime,
          "content-disposition": disposition,
          "cache-control": "private, max-age=300",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("Archivo no encontrado", { status: 404 });
    }
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60, { download: inline ? undefined : filename });
  if (error || !data) return new Response("Archivo no disponible", { status: 404 });
  return Response.redirect(data.signedUrl, 302);
}
