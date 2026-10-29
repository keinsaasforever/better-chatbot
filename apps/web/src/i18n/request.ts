import { getRequestConfig } from "next-intl/server";
import { safe } from "ts-safe";
import { getLocaleAction } from "./get-locale";
import deepmerge from "deepmerge";

let defaultMessages: any = undefined;

export default getRequestConfig(async () => {
  const locale = await getLocaleAction();

  if (!defaultMessages) {
    defaultMessages = (await import(`../../messages/en.json`)).default;
  }

  const messages = await safe(() => import(`../../messages/${locale}.json`))
    .map((m) => m.default)
    .orElse(defaultMessages);

  return {
    locale,
    messages:
      locale === "en" ? defaultMessages : deepmerge(defaultMessages, messages),
    getMessageFallback({ key, namespace }) {
      return `${namespace}.${key}`;
    },
  };
});
