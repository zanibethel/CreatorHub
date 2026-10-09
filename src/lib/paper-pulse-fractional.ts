/**
 * Broker allows fractional DAY simple market/stop orders but not fractional
 * multi-leg brackets. These helpers never authorize an order themselves.
 */
export function pulseFractionalQuantity(riskCap: number, allocationCap: number, ask: number): number | null {
  if (![riskCap,allocationCap,ask].every(n=>Number.isFinite(n)&&n>0)) return null;
  const min=Math.min(riskCap,allocationCap);
  const qty=Math.floor(min*1_000_000_000)/1_000_000_000;
  // Alpaca's minimum equity fractional notional is $1.
  if (qty<=0 || qty*ask<1 || !Number.isFinite(qty)) return null;
  return qty;
}

export type PulseEntryOrderMode = "bracket" | "fractional-simple-protected";
export function pulseEntryOrderMode(quantity:number):PulseEntryOrderMode|null {
  if(!Number.isFinite(quantity)||quantity<=0||quantity<0.000000001) return null;
  const nine=Math.floor(quantity*1_000_000_000+1e-7)/1_000_000_000;
  if(Math.abs(nine-quantity)>1e-9)return null;
  return Number.isSafeInteger(quantity) ? "bracket" : "fractional-simple-protected";
}

/** Stable, bot-attributed stop/flatten IDs allow lookup-first retries after timeouts. */
export function pulseCompanionClientOrderId(entryClientId:string,purpose:"stop"|"flatten"):string|null {
  const match=/^chb-pls-v([1-9][0-9]*)-([a-z0-9]+)-([a-z0-9]{6,24})$/.exec(entryClientId);
  if(!match) return null;
  const suffix=purpose==="stop"?"s":"f";
  const nextNonce=suffix+match[3].slice(1);
  return `chb-pls-v${match[1]}-${match[2]}-${nextNonce}`;
}
