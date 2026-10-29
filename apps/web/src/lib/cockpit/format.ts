/** Number and money formatting shared by the cockpit displays. */

/** Intl locale for an app locale; English uses en-GB for 24 h times. */
export function intlLocale(locale: string): string {
  return locale === "en" ? "en-GB" : locale;
}

/** Fraction digits of a currency (2 for EUR, 0 for JPY). */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Converts Stripe minor units (cents) to major units. */
export function fromMinor(amount: number, currency: string): number {
  return amount / 10 ** currencyDigits(currency);
}

export function formatMoney(
  locale: string,
  amount: number,
  currency: string,
  compact = true,
): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency: currency.toUpperCase(),
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency.toUpperCase()}`;
  }
}
