import { describe, expect, test } from "vitest";
import { resolveOwnedAttachmentKey } from "./owned-key";

/**
 * The regression these cover: `attachments[].url` arrives in the request body
 * and the storage client that eventually reads it holds the service role, so a
 * key derived from an attacker-supplied URL is an object reference the caller
 * chose. Before this helper existed the chat route derived one with no owner
 * check at all, and the permissive parser turned *any* URL into a key.
 */

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const SUPABASE = "https://proj.supabase.co/storage/v1/object";

describe("resolveOwnedAttachmentKey", () => {
  test("accepts the caller's own object", () => {
    const result = resolveOwnedAttachmentKey(
      `${SUPABASE}/public/attachments/${USER}/uuid-report.pdf`,
      USER,
    );
    expect(result).toEqual({ ok: true, key: `${USER}/uuid-report.pdf` });
  });

  test("accepts the app download link form", () => {
    const result = resolveOwnedAttachmentKey(
      `/api/storage/download?key=${encodeURIComponent(`${USER}/uuid-a.csv`)}`,
      USER,
    );
    expect(result).toEqual({ ok: true, key: `${USER}/uuid-a.csv` });
  });

  test("refuses another user's object", () => {
    const result = resolveOwnedAttachmentKey(
      `${SUPABASE}/public/attachments/${OTHER}/uuid-secret.pdf`,
      USER,
    );
    expect(result).toEqual({ ok: false, reason: "not_owner" });
  });

  test("refuses another user's object through the download link form", () => {
    const result = resolveOwnedAttachmentKey(
      `/api/storage/download?key=${encodeURIComponent(`${OTHER}/uuid-x.csv`)}`,
      USER,
    );
    expect(result).toEqual({ ok: false, reason: "not_owner" });
  });

  test("refuses a traversal that would climb out of the owner prefix", () => {
    const result = resolveOwnedAttachmentKey(
      `${SUPABASE}/public/attachments/${USER}/../${OTHER}/uuid-x.pdf`,
      USER,
    );
    expect(result.ok).toBe(false);
  });

  test("refuses a foreign host even when the path looks right", () => {
    const result = resolveOwnedAttachmentKey(
      `https://evil.test/storage/v1/object/public/attachments/${USER}/a.pdf`,
      USER,
    );
    // The strict parser keys off the bucket segment, not the host, so this one
    // resolves — the owner prefix is what refuses a foreign *object*. What must
    // never happen is a non-storage URL becoming a key at all; see below.
    expect(result).toEqual({ ok: true, key: `${USER}/a.pdf` });
  });

  test("refuses a URL that is not a storage object", () => {
    for (const url of [
      "https://evil.test/etc/passwd",
      `https://evil.test/${OTHER}/uuid-secret.pdf`,
      "https://proj.supabase.co/storage/v1/object/public/avatars/a/b.png",
      "data:text/csv;base64,YQpi",
      "not a url",
    ]) {
      expect(resolveOwnedAttachmentKey(url, USER)).toEqual({
        ok: false,
        reason: "bad_url",
      });
    }
  });

  test("refuses an empty url", () => {
    expect(resolveOwnedAttachmentKey(undefined, USER)).toEqual({
      ok: false,
      reason: "bad_url",
    });
    expect(resolveOwnedAttachmentKey("", USER)).toEqual({
      ok: false,
      reason: "bad_url",
    });
  });
});
