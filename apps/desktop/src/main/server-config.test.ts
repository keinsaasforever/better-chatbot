import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearServerUrl,
  normalizeServerUrl,
  readPreviousServerUrl,
  readServerUrl,
  resolveStartupServer,
  writeServerUrl,
} from "./server-config.js";

const CLOUD = "https://app.keinsaas.com";
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-config-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const startup = () =>
  resolveStartupServer({
    isDev: false,
    devUrl: "http://localhost:3000",
    cloudUrl: CLOUD,
    userDataDir: dir,
  });

describe("normalizeServerUrl", () => {
  it("adds https to a bare hostname and keeps only the origin", () => {
    expect(normalizeServerUrl("  my-chat.vercel.app/chat?x=1 ")).toEqual({
      ok: true,
      origin: "https://my-chat.vercel.app",
    });
  });

  it("accepts plain http only for this machine", () => {
    expect(normalizeServerUrl("http://localhost:3000")).toEqual({
      ok: true,
      origin: "http://localhost:3000",
    });
    expect(normalizeServerUrl("http://example.com")).toEqual({
      ok: false,
      reason: "insecure",
    });
  });

  it("rejects empty input and other schemes", () => {
    expect(normalizeServerUrl("   ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeServerUrl("file:///etc/passwd")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("resolveStartupServer", () => {
  it("asks on a fresh install", () => {
    expect(startup()).toEqual({ pick: true });
  });

  it("keeps an install from before the picker on the cloud, once and silently", () => {
    fs.mkdirSync(path.join(dir, "Local Storage"));
    expect(startup()).toEqual({ url: CLOUD });
    expect(readServerUrl(dir)).toBe(CLOUD);
  });

  it("uses the stored choice", () => {
    writeServerUrl(dir, "https://my-chat.vercel.app");
    expect(startup()).toEqual({ url: "https://my-chat.vercel.app" });
  });

  it("asks again after Change Server, even with cloud cookies around", () => {
    fs.mkdirSync(path.join(dir, "Local Storage"));
    writeServerUrl(dir, "https://my-chat.vercel.app");
    clearServerUrl(dir);
    expect(startup()).toEqual({ pick: true });
    expect(readPreviousServerUrl(dir)).toBe("https://my-chat.vercel.app");
  });

  it("ignores a hand-edited file that points somewhere unsafe", () => {
    fs.writeFileSync(
      path.join(dir, "server.json"),
      JSON.stringify({ url: "http://evil.example" }),
    );
    expect(readServerUrl(dir)).toBeNull();
    expect(startup()).toEqual({ pick: true });
  });

  it("always uses the dev server in development", () => {
    writeServerUrl(dir, "https://my-chat.vercel.app");
    expect(
      resolveStartupServer({
        isDev: true,
        devUrl: "http://localhost:3000",
        cloudUrl: CLOUD,
        userDataDir: dir,
      }),
    ).toEqual({ url: "http://localhost:3000" });
  });
});
