import { withAuth } from "auth/route-guard";
import { chatExportRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

export const GET = withAuth(async (_request, session) => {
  try {
    const exports = await chatExportRepository.selectSummaryByExporterId(
      session.user.id,
    );
    return NextResponse.json(exports);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get exports" },
      { status: 500 },
    );
  }
});
