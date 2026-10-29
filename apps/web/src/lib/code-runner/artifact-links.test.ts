import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  collectMessageArtifacts,
  isAppDownloadHref,
  isSandboxLikeHref,
  markdownUrlTransform,
  resolveArtifactLink,
} from "./artifact-links";

const artifacts = [
  {
    filename: "Angebot_Positionen.xlsx",
    url: "/api/storage/download?key=u%2Fuuid-Angebot_Positionen.xlsx",
  },
  {
    filename: "chart.png",
    url: "/api/storage/download?key=u%2Fuuid-chart.png",
  },
];

describe("isSandboxLikeHref", () => {
  it("recognises the ways a model points at a sandbox file", () => {
    for (const href of [
      "sandbox:/home/user/Angebot_Positionen.xlsx",
      "sandbox:/mnt/data/chart.png",
      "attachment:chart.png",
      "file:///home/user/chart.png",
      "/home/user/out/report.xlsx",
      "/mnt/data/report.xlsx",
      "report.xlsx",
      "./report.xlsx",
      "out/report.xlsx",
    ]) {
      expect(isSandboxLikeHref(href), href).toBe(true);
    }
  });

  it("leaves real links alone", () => {
    for (const href of [
      "https://example.com/report.xlsx",
      "http://localhost:3000/",
      "mailto:someone@example.com",
      "/chat/123",
      "/api/storage/download?key=k",
      "#section",
      "",
      undefined,
    ]) {
      expect(isSandboxLikeHref(href), String(href)).toBe(false);
    }
  });
});

describe("isAppDownloadHref", () => {
  it("matches only the durable download route", () => {
    expect(isAppDownloadHref("/api/storage/download?key=k")).toBe(true);
    expect(isAppDownloadHref("/api/storage/upload")).toBe(false);
    expect(isAppDownloadHref(undefined)).toBe(false);
  });
});

describe("resolveArtifactLink", () => {
  it("matches by basename, case-insensitively, decoding the name", () => {
    expect(
      resolveArtifactLink(
        "sandbox:/home/user/Angebot_Positionen.xlsx",
        artifacts,
      )?.url,
    ).toBe(artifacts[0].url);
    expect(
      resolveArtifactLink("attachment:CHART.PNG", artifacts)?.filename,
    ).toBe("chart.png");
    expect(
      resolveArtifactLink("./Angebot%5FPositionen.xlsx", artifacts)?.filename,
    ).toBe("Angebot_Positionen.xlsx");
  });

  it("returns null for a file the message did not produce", () => {
    expect(resolveArtifactLink("/home/user/nope.csv", artifacts)).toBeNull();
    expect(resolveArtifactLink("sandbox:/", artifacts)).toBeNull();
  });
});

describe("markdownUrlTransform", () => {
  it("keeps sandbox hrefs for the link renderer and still blocks scripts", () => {
    expect(markdownUrlTransform("sandbox:/home/user/a.xlsx")).toBe(
      "sandbox:/home/user/a.xlsx",
    );
    expect(markdownUrlTransform("javascript:alert(1)")).toBe("");
    expect(markdownUrlTransform("https://example.com/x")).toBe(
      "https://example.com/x",
    );
  });
});

describe("collectMessageArtifacts", () => {
  it("collects finished code-tool outputs only, with a stable signature", () => {
    const parts = [
      { type: "text", text: "hi" },
      {
        type: "tool-python-execution",
        toolCallId: "1",
        state: "output-available",
        input: {},
        output: {
          artifacts: [
            { filename: "a.xlsx", url: "/api/storage/download?key=a" },
            { filename: "huge.pdf", error: "too large" },
          ],
        },
      },
      {
        type: "tool-python-execution",
        toolCallId: "2",
        state: "input-available",
        input: {},
      },
      {
        type: "tool-webSearch",
        toolCallId: "3",
        state: "output-available",
        input: {},
        output: { artifacts: [{ filename: "x.csv", url: "u" }] },
      },
    ] as unknown as UIMessage["parts"];

    const first = collectMessageArtifacts(parts);

    expect(first.artifacts).toEqual([
      { filename: "a.xlsx", url: "/api/storage/download?key=a" },
      { filename: "huge.pdf", url: undefined },
    ]);
    expect(collectMessageArtifacts([...parts]).signature).toBe(first.signature);
    expect(collectMessageArtifacts([]).signature).toBe("");
  });
});
