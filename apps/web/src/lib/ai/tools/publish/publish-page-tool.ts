import { tool as createTool } from "ai";
import { publishedPageRepository } from "lib/db/repository";
import { buildPageSlug, isValidPageSlug } from "lib/published-page/slug";
import globalLogger from "logger";
import { JSONSchema7 } from "json-schema";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";

const logger = globalLogger.withDefaults({ message: "Publish page tool: " });

export const publishPageSchema: JSONSchema7 = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Short title, shown in the browser tab.",
    },
    html: {
      type: "string",
      description: "The complete self-contained HTML document.",
    },
    slug: {
      type: "string",
      description: "Existing slug to republish at the same URL.",
    },
  },
  required: ["title", "html"],
};

/** Mirrors the cap on the HTTP route so the two cannot disagree. */
const MAX_HTML_BYTES = 2 * 1024 * 1024;

/**
 * Publishing writes a row and returns a URL — no browser involved — so unlike
 * the code tools this one gets a real `execute` and runs inside the step loop.
 * The model can publish and answer with the link in the same turn.
 *
 * The session's userId is bound at construction, so the tool can only ever
 * publish as its own user: ownership is structural rather than validated.
 */
export const createPublishPageTool = (
  userId: string,
  organizationId?: string | null,
  threadId?: string | null,
) =>
  createTool({
    description: `Publish the current page to a permanent, shareable URL and return the link.

Use when the user asks to share, publish, or send someone a page you built.

\`html\` must be ONE self-contained HTML document. The published page is served as a static snapshot with no build step and no server, so:
- Put all CSS in a <style> tag and any JavaScript in an inline <script>. External stylesheets and script files will NOT load.
- No React, Vue, or npm packages. Plain HTML, CSS and vanilla JS only. CSS animations, transitions, transforms and scroll effects all work, as does inline JS.
- Reference images by the URLs listed in <uploaded_file_urls> or other absolute https URLs. Never inline base64 image data — it blows the size limit.
- This is a fresh document, not a copy of the sandbox preview. Rewrite the design as standalone HTML.

Pass \`slug\` to republish an existing page at the same URL; omit it to mint a new one. Anyone with the link can open a published page, so do not publish anything the user has marked private.`,
    inputSchema: jsonSchemaToZod(publishPageSchema),
    execute: async ({ title, html, slug: requestedSlug }) => {
      const fail = (message: string) => ({
        isError: true,
        message,
        url: null as string | null,
        slug: null as string | null,
        version: null as number | null,
      });

      if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
        return fail(
          "The page is too large to publish. Remove any base64-encoded images and reference them by URL instead.",
        );
      }

      let slug: string;
      if (requestedSlug) {
        if (!isValidPageSlug(requestedSlug)) {
          return fail("That is not a valid page link.");
        }
        const ownerId =
          await publishedPageRepository.selectOwnerIdBySlug(requestedSlug);
        // Republishing someone else's slug would silently replace their live
        // page, so refuse rather than fall back to minting a new one.
        if (ownerId !== userId) {
          return fail(
            "That page belongs to someone else and cannot be republished here.",
          );
        }
        slug = requestedSlug;
      } else {
        slug = buildPageSlug(title);
      }

      try {
        const page = await publishedPageRepository.publish({
          slug,
          title,
          html,
          ownerId: userId,
          organizationId,
          threadId,
        });

        return {
          isError: false,
          url: `/p/${page.slug}` as string | null,
          slug: page.slug as string | null,
          version: page.version as number | null,
          message:
            page.version > 1
              ? "Republished at the same link."
              : "Published. Anyone with this link can open it.",
        };
      } catch (error) {
        logger.error("Failed to publish page", error);
        return fail("Could not publish the page. Please try again.");
      }
    },
  });
