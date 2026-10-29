import { describe, expect, it } from "vitest";
import { extractFigureUrls } from "./figure-urls";

describe("extractFigureUrls", () => {
  it("extracts Agentset markdown image URLs", () => {
    const text =
      "Intro text\n![Diagram](https://files.agentset.ai/org/ns/img.png)\nMore text";
    expect(extractFigureUrls(text)).toEqual([
      "https://files.agentset.ai/org/ns/img.png",
    ]);
  });
});
