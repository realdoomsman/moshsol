import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ArweaveStore } from "./arweave";
import { cleanSocial, cleanText, parsePubkey, parsePubkeyList, ValidationError } from "./sanitize";

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_URI_LEN = 200;

type ImageKind = { ext: "png" | "jpg" | "gif" | "webp" | "svg"; mime: string };

const SVG_START =
  /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;
const SVG_ACTIVE = /<script|<foreignObject|javascript:|\son[a-z]+\s*=|<iframe|<embed|<object/i;

/** Identifies the image type from its magic bytes (never from the client-declared mime). */
export function sniffImage(buf: Buffer): ImageKind | null {
  const ascii = (start: number, end: number) => buf.subarray(start, end).toString("latin1");
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return { ext: "gif", mime: "image/gif" };
  if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  const text = buf.toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (SVG_START.test(text) && /<\/svg>\s*$/i.test(text)) {
    if (SVG_ACTIVE.test(text)) throw new ValidationError("SVG images must not contain scripts or event handlers");
    return { ext: "svg", mime: "image/svg+xml" };
  }
  return null;
}

interface UploadFields {
  name: string;
  symbol: string;
  description: string | null;
  twitter: string | null;
  telegram: string | null;
  /** The launch address the metadata belongs to (`launch`, the wizard always sends it): its `website` is the launch page. */
  launch: string | null;
  whitelist: string[] | null;
}

function validateFields(raw: Record<string, string>): UploadFields {
  const launch = raw.launch?.trim() || null;
  if (launch && !parsePubkey(launch)) throw new ValidationError("launch must be the base58 launch address");
  const name = cleanText(raw.name, "name", 32, { bytes: true });
  if (!name) throw new ValidationError("name is required");
  const symbol = cleanText(raw.symbol, "symbol", 10, { bytes: true });
  if (!symbol) throw new ValidationError("symbol is required");
  let whitelist: string[] | null = null;
  if (raw.whitelist !== undefined && raw.whitelist.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.whitelist);
    } catch {
      throw new ValidationError("whitelist must be a JSON array of base58 public keys");
    }
    whitelist = parsePubkeyList(parsed, "whitelist");
  }
  return {
    name,
    symbol,
    description: cleanText(raw.description, "description", 1000, { multiline: true }),
    twitter: cleanSocial(raw.twitter, "twitter"),
    telegram: cleanSocial(raw.telegram, "telegram"),
    launch,
    whitelist,
  };
}

/**
 * `POST /api/upload` (multipart): stores the image + a Metaplex-style JSON and returns their public URIs:
 * under FILES_DIR rooted at PUBLIC_URL, or on Arweave when `arweave` is set (STORAGE=arweave). The JSON's
 * `extensions.website` is the launch's own page (`<siteUrl>/launch/<launch>`), never a creator-supplied URL
 * (a `website` field is ignored).
 */
export function registerUpload(
  app: FastifyInstance,
  opts: { filesDir: string; publicUrl: string; siteUrl: string; arweave: ArweaveStore | null },
): void {
  app.post("/api/upload", async (req, reply) => {
    if (!req.isMultipart()) throw new ValidationError("expected multipart/form-data");
    const raw: Record<string, string> = {};
    let image: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        if (part.fieldname === "image") image = buf;
        continue;
      }
      if (part.valueTruncated) throw new ValidationError(`${part.fieldname} is too long`);
      raw[part.fieldname] = String(part.value);
    }
    if (!image || image.length === 0) throw new ValidationError("image file is required");
    const kind = sniffImage(image);
    if (!kind) throw new ValidationError("image must be a PNG, JPEG, GIF, WebP or SVG file");
    const fields = validateFields(raw);

    const extensions: Record<string, string> = {};
    if (fields.launch) extensions.website = `${opts.siteUrl}/launch/${fields.launch}`;
    if (fields.twitter) extensions.twitter = fields.twitter;
    if (fields.telegram) extensions.telegram = fields.telegram;
    const metadataFor = (imageUrl: string) => ({
      name: fields.name,
      symbol: fields.symbol,
      description: fields.description ?? "",
      image: imageUrl,
      extensions,
      ...(fields.whitelist ? { whitelist: fields.whitelist } : {}),
    });

    if (opts.arweave) {
      const stored = await opts.arweave.uploadLaunch(image, kind.mime, metadataFor);
      req.log.info({ ...stored, kind: kind.ext, bytes: image.length, whitelist: fields.whitelist?.length ?? 0 }, "upload stored on arweave");
      return reply.send(stored);
    }

    const id = randomBytes(9).toString("base64url");
    const imageUrl = `${opts.publicUrl}/files/img/${id}.${kind.ext}`;
    const uri = `${opts.publicUrl}/files/meta/${id}.json`;
    if (uri.length > MAX_URI_LEN) {
      throw new Error(`PUBLIC_URL is too long: metadata URI would be ${uri.length} > ${MAX_URI_LEN} chars`);
    }
    const metadata = metadataFor(imageUrl);

    await fs.writeFile(path.join(opts.filesDir, "img", `${id}.${kind.ext}`), image, { flag: "wx" });
    await fs.writeFile(path.join(opts.filesDir, "meta", `${id}.json`), JSON.stringify(metadata), { flag: "wx" });
    req.log.info({ id, kind: kind.ext, bytes: image.length, whitelist: fields.whitelist?.length ?? 0 }, "upload stored");
    return reply.send({ uri, image: imageUrl });
  });

  // Image only (profile avatars): same sniffing and limits, no metadata JSON.
  app.post("/api/upload/image", async (req, reply) => {
    if (!req.isMultipart()) throw new ValidationError("expected multipart/form-data");
    let image: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      const buf = await part.toBuffer();
      if (part.fieldname === "image") image = buf;
    }
    if (!image || image.length === 0) throw new ValidationError("image file is required");
    const kind = sniffImage(image);
    if (!kind) throw new ValidationError("image must be a PNG, JPEG, GIF, WebP or SVG file");
    if (opts.arweave) {
      const url = await opts.arweave.uploadImage(image, kind.mime);
      req.log.info({ image: url, kind: kind.ext, bytes: image.length }, "image stored on arweave");
      return reply.send({ image: url });
    }
    const id = randomBytes(9).toString("base64url");
    await fs.writeFile(path.join(opts.filesDir, "img", `${id}.${kind.ext}`), image, { flag: "wx" });
    req.log.info({ id, kind: kind.ext, bytes: image.length }, "image stored");
    return reply.send({ image: `${opts.publicUrl}/files/img/${id}.${kind.ext}` });
  });
}
