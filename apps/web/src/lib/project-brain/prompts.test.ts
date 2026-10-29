import { describe, expect, test } from "vitest";
import {
  buildConsolidationSystemPrompt,
  buildExtractionSystemPrompt,
  buildGatherSystemPrompt,
} from "./prompts";

describe("buildConsolidationSystemPrompt", () => {
  test("anchors to the current date and states the notify rule", () => {
    const prompt = buildConsolidationSystemPrompt();

    expect(prompt).toContain(String(new Date().getFullYear()));
    expect(prompt).toContain("`notify: true` only");
    expect(prompt).toContain("Keep at most 8 open to-dos");
    expect(prompt).toContain("Connector failures");
  });
});

describe("buildGatherSystemPrompt", () => {
  test("anchors the connector-read prompt to the current date", () => {
    const prompt = buildGatherSystemPrompt({ projectName: "Test project" });

    expect(prompt).toContain(String(new Date().getFullYear()));
    expect(prompt).toContain(
      "Interpret 'recent' relative to the current date above",
    );
  });

  test("includes the project's system prompt when set", () => {
    const prompt = buildGatherSystemPrompt({
      projectName: "Test project",
      projectSystemPrompt: "Only track invoices over $10k.",
    });

    expect(prompt).toContain(
      "Project instructions: Only track invoices over $10k.",
    );
  });

  test("omits the project instructions line when unset", () => {
    const prompt = buildGatherSystemPrompt({ projectName: "Test project" });

    expect(prompt).not.toContain("Project instructions:");
  });
});

describe("buildExtractionSystemPrompt", () => {
  test("anchors the widget-extraction prompt to the current date", () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain(String(new Date().getFullYear()));
    expect(prompt).toContain("never assume a year");
  });

  test("no longer asks for widgets and steers todos toward actionable items", () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).not.toContain("widget");
    expect(prompt).toContain("A calendar entry is not a todo");
    expect(prompt).toContain("sourceUrl");
  });

  // A Gmail 403 once became a "Gmail Access: Blocked" widget. Failed tool
  // results are filtered before extraction, but the model must also ignore
  // any error text that slips through inside otherwise valid payloads.
  test("tells the model that tool errors are not project facts", () => {
    const prompt = buildExtractionSystemPrompt();

    expect(prompt).toContain("Tool failures, HTTP errors");
    expect(prompt).toContain("are not project facts");
  });
});
