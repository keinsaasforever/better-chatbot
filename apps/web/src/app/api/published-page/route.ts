import { buildPageSlug, isValidPageSlug } from "@/lib/published-page/slug";
import { withAuth } from "auth/route-guard";
import { publishedPageRepository } from "lib/db/repository";
import globalLogger from "logger";
import { z } from "zod";

const logger = globalLogger.withDefaults({ message: "Published page: " });

/** Big enough for a generated landing page, small enough to bound the row. */
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const publishSchema = z.object({
  title: z.string().trim().min(1).max(200),
  html: z.string().min(1),
  threadId: z.uuid().optional(),
  // Republishing an existing page: same slug, new version, same URL.
  slug: z.string().max(64).optional(),
});

export const POST = withAuth(async (request, session) => {
  const parsed = publishSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid publish request" }, { status: 400 });
  }
  const { title, html, threadId, slug: requestedSlug } = parsed.data;

  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
    return Response.json({ error: "Page is too large" }, { status: 413 });
  }

  let slug: string;
  if (requestedSlug) {
    if (!isValidPageSlug(requestedSlug)) {
      return Response.json({ error: "Invalid slug" }, { status: 400 });
    }
    // Republishing must not let one user append a version to someone else's
    // slug — that would silently replace their live page.
    const ownerId =
      await publishedPageRepository.selectOwnerIdBySlug(requestedSlug);
    if (!ownerId) {
      return Response.json({ error: "Unknown page" }, { status: 404 });
    }
    if (ownerId !== session.user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
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
      ownerId: session.user.id,
      organizationId: (
        session.session as { activeOrganizationId?: string | null } | undefined
      )?.activeOrganizationId,
      threadId,
    });

    return Response.json({
      slug: page.slug,
      version: page.version,
      url: `/p/${page.slug}`,
    });
  } catch (error) {
    logger.error("Failed to publish page", error);
    return Response.json({ error: "Failed to publish" }, { status: 500 });
  }
});

export const DELETE = withAuth(async (request, session) => {
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug || !isValidPageSlug(slug)) {
    return Response.json({ error: "Invalid slug" }, { status: 400 });
  }

  const revoked = await publishedPageRepository.revokeBySlug(
    slug,
    session.user.id,
  );
  if (revoked === 0) {
    // Covers both "not yours" and "already revoked" — deliberately identical,
    // so this endpoint cannot be used to probe which slugs exist.
    return Response.json({ error: "Unknown page" }, { status: 404 });
  }

  return Response.json({ revoked });
});
