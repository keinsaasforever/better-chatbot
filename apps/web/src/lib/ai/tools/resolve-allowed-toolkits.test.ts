import { describe, expect, it } from "vitest";
import { AppDefaultToolkit } from ".";
import {
  getUserConfigurableAppToolkits,
  resolveAllowedAppDefaultToolkits,
} from "./resolve-allowed-toolkits";

describe("resolveAllowedAppDefaultToolkits", () => {
  it("strips deferred legal/document toolkits including in project chat", () => {
    const allowed = resolveAllowedAppDefaultToolkits({
      allowedAppDefaultToolkit: [
        AppDefaultToolkit.Code,
        AppDefaultToolkit.WebSearch,
        AppDefaultToolkit.Document,
        AppDefaultToolkit.Tabular,
        AppDefaultToolkit.KnowledgeBase,
      ],
      projectId: "project-123",
    });

    expect(allowed).toContain(AppDefaultToolkit.Code);
    expect(allowed).toContain(AppDefaultToolkit.WebSearch);
    expect(allowed).not.toContain(AppDefaultToolkit.Document);
    expect(allowed).not.toContain(AppDefaultToolkit.Tabular);
    expect(allowed).not.toContain(AppDefaultToolkit.KnowledgeBase);
  });
});

describe("getUserConfigurableAppToolkits", () => {
  it("hides deferred toolkits from the menu", () => {
    const visible = getUserConfigurableAppToolkits({ projectId: "p1" });
    expect(visible).not.toContain(AppDefaultToolkit.KnowledgeBase);
    expect(visible).not.toContain(AppDefaultToolkit.Document);
    expect(visible).not.toContain(AppDefaultToolkit.Tabular);
    expect(visible).toContain(AppDefaultToolkit.Code);
  });
});
