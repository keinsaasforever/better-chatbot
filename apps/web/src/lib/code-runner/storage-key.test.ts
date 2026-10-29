import { describe, expect, test } from "vitest";
import { storageKeyFromDownloadUrl } from "./storage-key";

describe("storageKeyFromDownloadUrl", () => {
  test("reads the key from the download link generated artifacts carry", () => {
    expect(
      storageKeyFromDownloadUrl(
        "/api/storage/download?key=user-1/template.html",
      ),
    ).toBe("user-1/template.html");
  });

  test("decodes an absolute download link", () => {
    expect(
      storageKeyFromDownloadUrl(
        "https://app.example.com/api/storage/download?key=user-1/Bautagebuch%20KW36.pdf",
      ),
    ).toBe("user-1/Bautagebuch KW36.pdf");
  });

  test("still reads a plain Supabase object URL", () => {
    expect(
      storageKeyFromDownloadUrl(
        "https://x.supabase.co/storage/v1/object/public/attachments/user-1/doc.csv",
      ),
    ).toBe("user-1/doc.csv");
  });

  test("rejects a URL that is not ours, so nothing external is fetched", () => {
    expect(
      storageKeyFromDownloadUrl("https://evil.example.com/x.pdf"),
    ).toBeNull();
    expect(
      storageKeyFromDownloadUrl("data:application/pdf;base64,AAAA"),
    ).toBeNull();
  });

  test("rejects a download link with no key", () => {
    expect(storageKeyFromDownloadUrl("/api/storage/download")).toBeNull();
    expect(storageKeyFromDownloadUrl("/api/storage/download?key=")).toBeNull();
  });
});
