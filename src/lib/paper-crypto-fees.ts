export type ObservedCryptoEntryFee = {
  feeQuantity: number | null;
  feeBps: number | null;
  feeUsd: number | null;
};

export function observeCryptoEntryFee(
  grossFilledQuantity: number,
  brokerSellableQuantity: number,
  averageFillPrice: number | null,
): ObservedCryptoEntryFee {
  if (
    !Number.isFinite(grossFilledQuantity)
    || !Number.isFinite(brokerSellableQuantity)
    || grossFilledQuantity <= 0
    || brokerSellableQuantity <= 0
    || brokerSellableQuantity > grossFilledQuantity
  ) {
    return { feeQuantity: null, feeBps: null, feeUsd: null };
  }

  const feeQuantity = Math.max(0, grossFilledQuantity - brokerSellableQuantity);
  const feeBps = feeQuantity / grossFilledQuantity * 10_000;
  const feeUsd = averageFillPrice !== null
    && Number.isFinite(averageFillPrice)
    && averageFillPrice > 0
      ? feeQuantity * averageFillPrice
      : null;

  return { feeQuantity, feeBps, feeUsd };
}
