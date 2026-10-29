import { Buffer } from "node:buffer";
import type { UploadContent } from "./file-storage.interface";
import logger from "logger";
import { withTimeout } from "lib/utils";

export const sanitizeFilename = (filename: string) => {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
};

/**
 * Infer content type from filename extension.
 * Returns "application/octet-stream" for unknown types.
 */
export const getContentTypeFromFilename = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",

    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",

    // Text
    txt: "text/plain",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    xml: "application/xml",
    csv: "text/csv",
    md: "text/markdown",

    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",

    // Video
    mp4: "video/mp4",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mov: "video/quicktime",

    // Archives
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",
  };

  return ext && mimeTypes[ext] ? mimeTypes[ext] : "application/octet-stream";
};

/** Storage keys are `userId/uuid-filename`; strip the uuid for the download name. */
const UUID_KEY_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

export const downloadFilenameFromKey = (key: string): string => {
  const basename = key.split("/").pop() || "download";
  return basename.replace(UUID_KEY_PREFIX, "") || "download";
};

export const resolveStoragePrefix = () => {
  const raw = process.env.FILE_STORAGE_PREFIX ?? "uploads";

  return raw.replace(/^\/+|\/+$|\.+/g, "").trim();
};

export const storageKeyFromUrl = (input: string): string | null => {
  if (!input) return null;

  try {
    const url = new URL(input);
    const pathname = decodeURIComponent(url.pathname);

    // Handle Supabase Storage URLs:
    // Format: /storage/v1/object/public/{bucket}/{path}
    // or: /storage/v1/object/authenticated/{bucket}/{path}
    // or: /storage/v1/object/sign/{bucket}/{path} (signed URLs)
    const supabaseMatch = pathname.match(
      /^\/storage\/v1\/object\/(?:public|authenticated|sign)\/[^/]+\/(.+)$/,
    );
    if (supabaseMatch) {
      return supabaseMatch[1]; // Return just the object path without bucket
    }

    // Anything else is not one of our objects. This used to fall back to the
    // raw pathname, which turned *any* URL into a storage key — combined with
    // a service-role download that is an object reference under the caller's
    // control. Callers must skip a URL they cannot recognise.
    return null;
  } catch {
    return null;
  }
};

const isArrayBufferLike = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer;

const isArrayBufferView = (value: unknown): value is ArrayBufferView =>
  ArrayBuffer.isView(value as ArrayBufferView);

const isBlobLike = (value: unknown): value is Blob =>
  typeof Blob !== "undefined" && value instanceof Blob;

const isWebReadableStream = (
  value: unknown,
): value is ReadableStream<Uint8Array> =>
  typeof ReadableStream !== "undefined" && value instanceof ReadableStream;

const isNodeReadableStream = (value: unknown): value is NodeJS.ReadableStream =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as NodeJS.ReadableStream).pipe === "function";

const nodeStreamToBuffer = async (stream: NodeJS.ReadableStream) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.once("end", () => resolve(Buffer.concat(chunks)));
    stream.once("error", reject);
  });

const webStreamToBuffer = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
    }
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return Buffer.from(joined);
};

export const toBuffer = async (content: UploadContent) => {
  if (Buffer.isBuffer(content)) {
    return content;
  }

  if (isArrayBufferLike(content)) {
    return Buffer.from(content);
  }

  if (isArrayBufferView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }

  if (isBlobLike(content)) {
    const arrayBuffer = await content.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (isWebReadableStream(content)) {
    return webStreamToBuffer(content);
  }

  if (isNodeReadableStream(content)) {
    return nodeStreamToBuffer(content);
  }

  throw new TypeError("Unsupported upload content type");
};

export async function getBase64Data(image: {
  mimeType: string;
  data: string | Uint8Array | ArrayBuffer | Buffer | URL;
}): Promise<{ data: string; mimeType: string }> {
  if (!image.data) {
    throw new Error("No image data provided");
  }

  const data = image.data;

  // Case 1: Buffer, Uint8Array, or ArrayBuffer
  if (Buffer.isBuffer(data)) {
    return {
      data: data.toString("base64"),
      mimeType: image.mimeType,
    };
  }

  if (data instanceof Uint8Array) {
    return {
      data: Buffer.from(data).toString("base64"),
      mimeType: image.mimeType,
    };
  }

  if (data instanceof ArrayBuffer) {
    return {
      data: Buffer.from(data).toString("base64"),
      mimeType: image.mimeType,
    };
  }

  // Case 2: URL object
  if (data instanceof URL) {
    const response = await withTimeout(
      fetch(data.href).catch((err) => {
        logger.withTag("getBase64Data").error(err);
        throw err;
      }),
      10000,
    );
    const buffer = await response.arrayBuffer();
    return {
      data: Buffer.from(buffer).toString("base64"),
      mimeType: image.mimeType,
    };
  }

  // From here, data must be a string
  if (typeof data !== "string") {
    throw new Error("Invalid data type");
  }

  // Case 3: data URL (data:image/png;base64,...)
  if (data.startsWith("data:")) {
    const base64Match = data.match(/^data:[^;]+;base64,(.+)$/);
    if (base64Match) {
      return {
        data: base64Match[1], // Extract base64 part only
        mimeType: image.mimeType,
      };
    }
    throw new Error("Invalid data URL format");
  }

  // Case 4: HTTP/HTTPS URL
  if (data.startsWith("http://") || data.startsWith("https://")) {
    const response = await fetch(data);
    const buffer = await response.arrayBuffer();
    return {
      data: Buffer.from(buffer).toString("base64"),
      mimeType: image.mimeType,
    };
  }

  // Case 5: Already pure base64 string
  // Check if it looks like base64 (alphanumeric + / + = only)
  if (/^[A-Za-z0-9+/]+=*$/.test(data)) {
    return {
      data,
      mimeType: image.mimeType,
    };
  }

  throw new Error("Unsupported image data format");
}
