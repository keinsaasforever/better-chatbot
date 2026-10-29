export function slugifyTitle(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function pageSlug(type: string, title: string) {
  const base = slugifyTitle(title) || "untitled";
  const prefix =
    type === "person"
      ? "people"
      : type === "organization"
        ? "organizations"
        : type === "course"
          ? "courses"
          : type === "task"
            ? "tasks"
            : type === "meeting"
              ? "meetings"
              : type === "voice"
                ? "voice"
                : type === "concept"
                  ? "concepts"
                  : "notes";

  return `${prefix}/${base}`;
}
