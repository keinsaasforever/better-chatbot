"use server";
import { cookies, headers } from "next/headers";
import { COOKIE_KEY_LOCALE, SUPPORTED_LOCALES } from "lib/const";

function validateLocale(locale?: string): boolean {
  return SUPPORTED_LOCALES.some((v) => v.code === locale);
}

async function getLocaleFromCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const locale = cookieStore.get(COOKIE_KEY_LOCALE)?.value;

  return validateLocale(locale) ? locale : undefined;
}

async function getLocalFromHeader(): Promise<string | undefined> {
  const headerStore = await headers();
  const locale = headerStore
    .get("accept-language")
    ?.split(",")[0]
    ?.trim()
    .split("-")[0];

  return validateLocale(locale) ? locale : undefined;
}

export async function getLocaleAction() {
  let locale: string | undefined;

  locale = await getLocaleFromCookie();
  if (!locale) {
    locale = await getLocalFromHeader();
  }

  return locale || SUPPORTED_LOCALES[0].code;
}
