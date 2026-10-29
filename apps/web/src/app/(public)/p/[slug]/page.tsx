import { isValidPageSlug } from "@/lib/published-page/slug";
import { publishedPageRepository } from "lib/db/repository";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

// The slug is the capability. Rendering it must never be cached at the edge
// across visitors, and a revoke has to take effect immediately.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidPageSlug(slug)) return { title: "Not found" };
  const page = await publishedPageRepository.selectLiveBySlug(slug);
  return {
    title: page?.title ?? "Not found",
    // Unlisted means unlisted: a shared link should not end up in a search
    // index just because someone forwarded it.
    robots: { index: false, follow: false },
  };
}

export default async function PublishedPage({ params }: Props) {
  const { slug } = await params;

  // Reject malformed slugs before touching the DB — this endpoint is
  // unauthenticated, so it is the one people will throw junk at.
  if (!isValidPageSlug(slug)) notFound();

  const page = await publishedPageRepository.selectLiveBySlug(slug);
  // Revoked, expired, and never-existed are all a plain 404 on purpose: the
  // response must not reveal which of the three it was.
  if (!page) notFound();

  return (
    <iframe
      // The published HTML is model-generated and must not run with access to
      // this origin — a sandboxed iframe keeps it away from cookies, storage
      // and the parent DOM. allow-scripts without allow-same-origin means
      // scripts run in an opaque origin, which is what makes that safe.
      sandbox="allow-scripts allow-popups allow-forms"
      srcDoc={page.html}
      title={page.title}
      className="h-dvh w-full border-0"
    />
  );
}
