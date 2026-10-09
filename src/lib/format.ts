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
