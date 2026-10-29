import { describe, expect, it } from "vitest";
import {
  classifyNavigation,
  isAppDownloadUrl,
  isCheckoutReturnUrl,
} from "./external-links.js";

const APP_ORIGIN = "https://app.keinsaas.com";

describe("classifyNavigation", () => {
  it("keeps same-origin navigation in the app window", () => {
    expect(classifyNavigation(`${APP_ORIGIN}/chat/123`, APP_ORIGIN)).toBe(
      "app",
    );
  });

  it("hands a same-origin file download to the download pipeline, not a window", () => {
    // The route answers with an attachment (or a redirect to one); a window
    // opened for it would stay blank.
    expect(
      classifyNavigation(
        `${APP_ORIGIN}/api/storage/download?key=u%2Fx.xlsx`,
        APP_ORIGIN,
      ),
    ).toBe("download");
    expect(
      classifyNavigation(
        `${APP_ORIGIN}/api/storage/download?key=u%2Fx.pdf&inline=1`,
        APP_ORIGIN,
      ),
    ).toBe("download");
    expect(
      classifyNavigation(
        `${APP_ORIGIN}/api/projects/p1/documents/d1/download?redirect=1`,
        APP_ORIGIN,
      ),
    ).toBe("download");
  });

  it("does not treat a download path on another host as ours", () => {
    expect(
      classifyNavigation(
        "https://other.example/api/storage/download?key=x",
        APP_ORIGIN,
      ),
    ).toBe("external");
  });

  it("sends an identity-provider handshake to the system browser", () => {
    // Providers reject OAuth inside embedded web views; sign-in runs in the
    // browser and returns through the keinsaas:// deep link instead.
    for (const url of [
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
      "https://github.com/login/oauth/authorize",
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    ]) {
      expect(classifyNavigation(url, APP_ORIGIN)).toBe("external");
    }
  });

  it("routes Stripe checkout and the billing portal to the checkout window", () => {
    expect(
      classifyNavigation(
        "https://checkout.stripe.com/c/pay/cs_live_a1",
        APP_ORIGIN,
      ),
    ).toBe("checkout");
    expect(
      classifyNavigation(
        "https://billing.stripe.com/p/session/live_x",
        APP_ORIGIN,
      ),
    ).toBe("checkout");
    expect(classifyNavigation("https://stripe.com/pricing", APP_ORIGIN)).toBe(
      "checkout",
    );
  });

  it("only matches Stripe on a dot boundary", () => {
    // These are third-party hosts wearing a Stripe-shaped name; they must not
    // inherit the checkout window's unrestricted navigation.
    expect(classifyNavigation("https://evil-stripe.com/pay", APP_ORIGIN)).toBe(
      "external",
    );
    expect(
      classifyNavigation("https://stripe.com.attacker.io/pay", APP_ORIGIN),
    ).toBe("external");
  });

  it("sends ordinary web links to the system browser", () => {
    for (const url of [
      "https://calendar.app.google/32i6S3FhsYnV4X5fA",
      "https://apps.apple.com/app/id123",
      "https://docs.keinsaas.com/getting-started",
      "http://example.com",
      "mailto:support@keinsaas.com",
    ]) {
      expect(classifyNavigation(url, APP_ORIGIN)).toBe("external");
    }
  });

  it("blocks schemes we will not hand anywhere", () => {
    expect(classifyNavigation("file:///etc/passwd", APP_ORIGIN)).toBe("block");
    expect(classifyNavigation("javascript:alert(1)", APP_ORIGIN)).toBe("block");
  });

  it("blocks an unparseable URL instead of throwing", () => {
    expect(() => classifyNavigation("not a url", APP_ORIGIN)).not.toThrow();
    expect(classifyNavigation("not a url", APP_ORIGIN)).toBe("block");
  });

  it("treats a localhost dev origin as the app", () => {
    const dev = "http://localhost:3000";
    expect(classifyNavigation(`${dev}/billing`, dev)).toBe("app");
    expect(
      classifyNavigation(`${dev}/api/storage/download?key=u%2Fx.csv`, dev),
    ).toBe("download");
    // A different port is a different origin, so it is just an outside link.
    expect(classifyNavigation("http://localhost:4000/", dev)).toBe("external");
  });
});

describe("isAppDownloadUrl", () => {
  it("recognises the app's download routes", () => {
    expect(
      isAppDownloadUrl(`${APP_ORIGIN}/api/storage/download?key=k`, APP_ORIGIN),
    ).toBe(true);
    expect(
      isAppDownloadUrl(
        `${APP_ORIGIN}/api/projects/p1/documents/d1/download`,
        APP_ORIGIN,
      ),
    ).toBe(true);
  });

  it("rejects pages, other hosts and garbage", () => {
    expect(isAppDownloadUrl(`${APP_ORIGIN}/chat/1`, APP_ORIGIN)).toBe(false);
    expect(
      isAppDownloadUrl(
        "https://other.example/api/storage/download",
        APP_ORIGIN,
      ),
    ).toBe(false);
    expect(isAppDownloadUrl("not a url", APP_ORIGIN)).toBe(false);
  });
});

describe("isCheckoutReturnUrl", () => {
  it("recognises a return to the app origin", () => {
    expect(
      isCheckoutReturnUrl(`${APP_ORIGIN}/?checkout=success`, APP_ORIGIN),
    ).toBe(true);
  });

  it("recognises the production success_url while running against localhost", () => {
    // Autumn's dashboard-configured success_url points at production even in dev.
    expect(
      isCheckoutReturnUrl(
        "https://app.keinsaas.com/?checkout=success",
        "http://localhost:3000",
      ),
    ).toBe(true);
    expect(
      isCheckoutReturnUrl(
        "https://keinsaas.com/thanks",
        "http://localhost:3000",
      ),
    ).toBe(true);
  });

  it("does not fire while the user is still on Stripe", () => {
    expect(
      isCheckoutReturnUrl(
        "https://checkout.stripe.com/c/pay/cs_live_a1",
        APP_ORIGIN,
      ),
    ).toBe(false);
  });

  it("does not fire on a 3-D Secure hand-off to the cardholder's bank", () => {
    expect(
      isCheckoutReturnUrl("https://acs.examplebank.com/3ds", APP_ORIGIN),
    ).toBe(false);
  });

  it("returns false for an unparseable URL", () => {
    expect(isCheckoutReturnUrl("not a url", APP_ORIGIN)).toBe(false);
  });
});
