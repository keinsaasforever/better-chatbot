export type UploadContent =
  | Buffer
  | Blob
  | File
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream<Uint8Array>
  | NodeJS.ReadableStream;

export interface FileMetadata {
  key: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt?: Date;
}

export interface UploadOptions {
  filename?: string;
  contentType?: string;
  userId?: string;
  projectId?: string;
  uploadType?: "avatar" | "attachment" | "ai-generated" | "knowledge-base";
}

export interface UploadResult {
  key: string;
  sourceUrl: string; // Public URL that anyone can access
  metadata: FileMetadata;
}

export interface UploadUrlOptions {
  filename: string;
  contentType: string;
  expiresInSeconds?: number;
}

export type UploadUrlMethod = "PUT" | "POST";

export interface UploadUrl {
  key: string;
  url: string;
  method: UploadUrlMethod;
  expiresAt: Date;
  headers?: Record<string, string>;
  fields?: Record<string, string>;
}

export interface SignedUrlOptions {
  /** `true` keeps the object's name; a string sets the download filename. */
  download?: string | boolean;
}

export interface FileStorage {
  /** Upload file content directly from the server (e.g. AI generated image). */
  upload(
    content: UploadContent,
    options?: UploadOptions,
  ): Promise<UploadResult>;

  /**
   * Create a short-lived public upload target for clients (e.g. presigned URL).
   * Return null if the backend does not support client-side uploads.
   */
  createUploadUrl?(options: UploadUrlOptions): Promise<UploadUrl | null>;

  /** Retrieve file bytes in server environment. */
  download(key: string): Promise<Buffer>;

  /** Delete the file from storage. */
  delete(key: string): Promise<void>;

  /** Check existence without downloading. */
  exists(key: string): Promise<boolean>;

  /** Fetch stored metadata. */
  getMetadata(key: string): Promise<FileMetadata | null>;

  /** Public URL used by clients to read the file (same as UploadResult.sourceUrl). */
  getSourceUrl(key: string): Promise<string | null>;

  /** Optional convenience for providing a forced download URL when supported by the backend. */
  getDownloadUrl?(key: string): Promise<string | null>;

  /** Generate a short-lived signed URL for private bucket access. */
  /**
   * Short-lived URL for a private object. `download` asks the storage CDN to
   * answer with an attachment disposition (and that filename), so a click
   * saves the file instead of rendering it.
   */
  getSignedUrl?(
    key: string,
    expiresIn?: number,
    options?: SignedUrlOptions,
  ): Promise<string | null>;
}
