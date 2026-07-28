export const VAT_RATE = 0.12;

export const roundCurrency = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function vatInclusiveBreakdown(inclusiveAmount) {
  const totalAmount = roundCurrency(inclusiveAmount);
  const subtotal = roundCurrency(totalAmount / (1 + VAT_RATE));
  const vatAmount = roundCurrency(totalAmount - subtotal);
  return { subtotal, vatAmount, totalAmount, vatRate: VAT_RATE };
}
