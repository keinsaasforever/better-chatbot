import { getTranslations } from "next-intl/server";

/** Dark placeholder in the cockpit palette while the feeds load. */
export default async function CockpitLoading() {
  const t = await getTranslations("Cockpit");
  return (
    <div
      className="flex min-h-full flex-col items-center justify-center gap-3 p-8"
      style={{ backgroundColor: "#07090c" }}
      aria-busy="true"
    >
      <span
        className="animate-pulse text-xs uppercase tracking-wider"
        style={{
          color: "#ffc46b",
          fontFamily:
            'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        {t("loading")}
      </span>
    </div>
  );
}
