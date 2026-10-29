import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultSavePath,
  describeDownloadUrl,
  downloadNotificationText,
  sanitizeDownloadFilename,
} from "./download-paths.js";

describe("sanitizeDownloadFilename", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeDownloadFilename("Angebot_2026-09.xlsx")).toBe(
      "Angebot_2026-09.xlsx",
    );
  });

  it("drops directories and characters the OS refuses", () => {
    expect(sanitizeDownloadFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDownloadFilename('re:po"rt?.pdf')).toBe("re_po_rt_.pdf");
    expect(sanitizeDownloadFilename(".hidden.csv")).toBe("hidden.csv");
  });

  it("falls back when nothing usable is left", () => {
    expect(sanitizeDownloadFilename("")).toBe("download");
    expect(sanitizeDownloadFilename("...")).toBe("download");
  });
});

describe("defaultSavePath", () => {
  it("starts the dialog in the downloads folder with the file's own name", () => {
    expect(defaultSavePath("/Users/me/Downloads", "report.xlsx")).toBe(
      path.join("/Users/me/Downloads", "report.xlsx"),
    );
  });
});

describe("describeDownloadUrl", () => {
  it("never includes the query string", () => {
    expect(
      describeDownloadUrl(
        "https://app.keinsaas.com/api/storage/download?key=u%2Fsecret.xlsx",
      ),
    ).toBe("https://app.keinsaas.com/api/storage/download");
  });

  it("tolerates garbage", () => {
    expect(describeDownloadUrl("not a url")).toBe("(invalid url)");
  });
});

describe("downloadNotificationText", () => {
  it("picks the language from a full locale tag", () => {
    expect(downloadNotificationText("de-DE", "a.xlsx", "completed")).toEqual({
      title: "Download abgeschlossen",
      body: "a.xlsx wurde gespeichert.",
    });
  });

  it("falls back to English for an unknown locale", () => {
    expect(downloadNotificationText("xx", "a.xlsx", "failed")).toEqual({
      title: "Download failed",
      body: "a.xlsx could not be downloaded.",
    });
  });
});
