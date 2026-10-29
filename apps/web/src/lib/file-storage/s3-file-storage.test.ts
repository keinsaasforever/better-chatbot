import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async (_c, _cmd, { expiresIn }: any) =>
      `https://example.com/presigned?exp=${expiresIn}`,
  ),
}));

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class BaseCmd {
    constructor(public input: any) {}
  }
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
    PutObjectCommand: class extends BaseCmd {},
    GetObjectCommand: class extends BaseCmd {},
    DeleteObjectCommand: class extends BaseCmd {},
    HeadObjectCommand: class extends BaseCmd {},
  };
});

import { createS3FileStorage } from "./s3-file-storage";

describe("s3-file-storage", () => {
  beforeEach(() => {
    sendMock.mockReset();
    process.env.FILE_STORAGE_S3_BUCKET = "my-bucket";
    process.env.FILE_STORAGE_S3_REGION = "us-east-2";
    process.env.FILE_STORAGE_PREFIX = "uploads";
    delete process.env.FILE_STORAGE_S3_PUBLIC_BASE_URL;
    delete process.env.FILE_STORAGE_S3_ENDPOINT;
    delete process.env.FILE_STORAGE_S3_FORCE_PATH_STYLE;
  });

  it("uploads and returns sourceUrl + metadata", async () => {
    // PutObject ok
    sendMock.mockResolvedValueOnce({});
    const storage = createS3FileStorage();
    const res = await storage.upload(Buffer.from("abc"), {
      filename: "file.txt",
      contentType: "text/plain",
    });
    expect(res.key).toMatch(/^uploads\//);
    expect(res.sourceUrl).toMatch(
      /^https:\/\/my-bucket.s3.us-east-2.amazonaws.com\//,
    );
    expect(res.metadata.size).toBe(3);
  });

  it("createUploadUrl returns PUT and headers", async () => {
    const storage = createS3FileStorage();
    const out = await storage.createUploadUrl!({
      filename: "img.png",
      contentType: "image/png",
      expiresInSeconds: 600,
    });
    expect(out?.method).toBe("PUT");
    expect(out?.headers).toEqual({ "Content-Type": "image/png" });
    expect(out?.url).toContain("exp=600");
  });

  it("exists returns true/false via HeadObject", async () => {
    const storage = createS3FileStorage();
    // true
    sendMock.mockResolvedValueOnce({});
    expect(await storage.exists("uploads/a.txt")).toBe(true);
    // false
    const err: any = new Error("not found");
    err.$metadata = { httpStatusCode: 404 };
    sendMock.mockRejectedValueOnce(err);
    expect(await storage.exists("uploads/missing.txt")).toBe(false);
  });

  it("getMetadata maps fields", async () => {
    const storage = createS3FileStorage();
    sendMock.mockResolvedValueOnce({
      ContentType: "text/plain",
      ContentLength: 10,
      LastModified: new Date("2020-01-01"),
    });
    const meta = await storage.getMetadata("uploads/x.txt");
    expect(meta?.contentType).toBe("text/plain");
    expect(meta?.size).toBe(10);
  });

  it("getSourceUrl respects PUBLIC_BASE_URL when set", async () => {
    process.env.FILE_STORAGE_S3_PUBLIC_BASE_URL = "https://cdn.example.com";
    const storage = createS3FileStorage();
    const url = await storage.getSourceUrl("uploads/x.txt");
    expect(url).toBe("https://cdn.example.com/uploads/x.txt");
  });
});
