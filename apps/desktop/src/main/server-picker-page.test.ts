import { describe, expect, it } from "vitest";
import { buildServerPickerHtml } from "./server-picker-page.js";

const CLOUD = "https://app.keinsaas.com";

describe("buildServerPickerHtml", () => {
  it("speaks German on a German system and English otherwise", () => {
    expect(
      buildServerPickerHtml({ locale: "de-DE", cloudUrl: CLOUD }),
    ).toContain("Womit möchtest du dich verbinden?");
    expect(
      buildServerPickerHtml({ locale: "fr-FR", cloudUrl: CLOUD }),
    ).toContain("Where do you want to connect?");
  });

  it("pre-selects the previous own server, escaped", () => {
    const html = buildServerPickerHtml({
      locale: "en",
      cloudUrl: CLOUD,
      previous: 'https://x.dev/"><script>alert(1)</script>',
    });
    expect(html).toContain('value="own" checked');
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("pre-selects the cloud when that was the last choice", () => {
    const html = buildServerPickerHtml({
      locale: "en",
      cloudUrl: CLOUD,
      previous: CLOUD,
    });
    expect(html).toContain('value="cloud" checked');
    expect(html).not.toContain(`value="${CLOUD}"`);
  });

  it("lets the browser accept a bare hostname", () => {
    expect(buildServerPickerHtml({ locale: "en", cloudUrl: CLOUD })).toContain(
      '<form id="form" novalidate>',
    );
  });
});
