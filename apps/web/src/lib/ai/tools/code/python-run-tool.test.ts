import type { JSONSchema7 } from "json-schema";
import { describe, expect, test } from "vitest";
import { pythonExecutionSchema, pythonExecutionTool } from "./python-run-tool";

/**
 * The prompt is the only thing standing between a scratch file and the user's
 * download list: `collectGeneratedFiles` diffs the whole working directory and
 * has no way to tell a build artifact from a deliverable. A reworded
 * description that drops this guidance brings back the bug where a user who
 * asked for a PDF received a .pdf card and a .html card and concluded the
 * wrong file had been produced.
 */

const codeFieldDescription = () => {
  const code = (pythonExecutionSchema.properties as Record<string, JSONSchema7>)
    ?.code;
  return code?.description ?? "";
};

describe("python-execution guidance on where files go", () => {
  test("both descriptions send intermediates to /tmp", () => {
    for (const text of [
      String(pythonExecutionTool.description ?? ""),
      codeFieldDescription(),
    ]) {
      expect(text).toContain("/tmp");
      // The reason, not just the rule: a model follows an instruction it
      // understands the cost of breaking. Whitespace-tolerant because these
      // are wrapped prose, not one-liners.
      expect(text).toMatch(/not\s+for\s+(them|the user)/i);
    }
  });

  test("still says a deliverable belongs in the working directory", () => {
    // The fix must not overshoot into "write everything to /tmp", which would
    // deliver nothing at all.
    expect(String(pythonExecutionTool.description ?? "")).toMatch(
      /save it to the working directory/i,
    );
    expect(codeFieldDescription()).toMatch(/working directory/i);
  });
});
