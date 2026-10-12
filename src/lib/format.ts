const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatINR(amount: number): string {
  return inrFormatter.format(amount);
}

const compactFormatter = new Intl.NumberFormat("en-IN");

export function formatCount(value: number): string {
  return compactFormatter.format(value);
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Formats an amount in the smallest currency unit (paise for INR). */
export function formatMoney(amountMinor: number, currency = "INR"): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(amountMinor / 100);
}
