import { AppDefaultToolkit } from ".";

/**
 * Hidden from the tool menu and never loaded for chat.
 * Re-enable for the legal department tab (analyze-document, edit-document,
 * create-tabular-review, searchKnowledgeBase).
 */
export const DEFERRED_APP_TOOLKITS: AppDefaultToolkit[] = [
  AppDefaultToolkit.KnowledgeBase,
  AppDefaultToolkit.Document,
  AppDefaultToolkit.Tabular,
];

export function filterDeferredAppToolkits(
  toolkits: AppDefaultToolkit[] | undefined,
): AppDefaultToolkit[] {
  return (toolkits ?? []).filter((t) => !DEFERRED_APP_TOOLKITS.includes(t));
}

export function resolveAllowedAppDefaultToolkits(input: {
  allowedAppDefaultToolkit?: string[];
  projectId?: string | null;
}): string[] {
  const base =
    input.allowedAppDefaultToolkit ?? Object.values(AppDefaultToolkit);

  return filterDeferredAppToolkits(base as AppDefaultToolkit[]);
}

export function getUserConfigurableAppToolkits(_options?: {
  projectId?: string | null;
}): AppDefaultToolkit[] {
  const hidden = new Set<AppDefaultToolkit>(DEFERRED_APP_TOOLKITS);
  return Object.values(AppDefaultToolkit).filter((t) => !hidden.has(t));
}
