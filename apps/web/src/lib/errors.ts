/**
 * Simple custom error classes
 */

export class AppError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/**
 * File storage error types
 */
class FileStorageError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "FileStorageError";
  }
}

export class FileNotFoundError extends FileStorageError {
  constructor(fileId: string, cause?: unknown) {
    super(`File not found: ${fileId}`, "FILE_NOT_FOUND", cause);
    this.name = "FileNotFoundError";
  }
}
