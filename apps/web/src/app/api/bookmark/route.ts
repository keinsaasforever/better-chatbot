import { withAuth } from "auth/route-guard";
import { bookmarkRepository } from "lib/db/repository";
import { z } from "zod";

const BookmarkTable = z.object({
  itemId: z.string().min(1),
  itemType: z.enum(["agent", "workflow"]),
});

export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { itemId, itemType } = BookmarkTable.parse(body);

    // Check if user has access to bookmark this item
    const hasAccess = await bookmarkRepository.checkItemAccess(
      itemId,
      itemType,
      session.user.id,
    );

    if (!hasAccess) {
      return Response.json(
        { error: "Item not found or access denied" },
        { status: 404 },
      );
    }

    // Create bookmark
    await bookmarkRepository.createBookmark(session.user.id, itemId, itemType);

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Error creating bookmark:", error);
    return Response.json(
      { error: "Failed to create bookmark" },
      { status: 500 },
    );
  }
});

export const DELETE = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { itemId, itemType } = BookmarkTable.parse(body);

    // Remove bookmark
    await bookmarkRepository.removeBookmark(session.user.id, itemId, itemType);

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Error deleting bookmark:", error);
    return Response.json(
      { error: "Failed to delete bookmark" },
      { status: 500 },
    );
  }
});
