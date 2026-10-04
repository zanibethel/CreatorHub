import { PAPER_BOT_PROFILES } from "./paper-bot-profiles";

const PREFIX = "chb";
const tagToBot = new Map(PAPER_BOT_PROFILES.map(profile => [profile.brokerTag, profile.id] as const));
const botToTag = new Map(PAPER_BOT_PROFILES.map(profile => [profile.id, profile.brokerTag] as const));

const safeNonce = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);

export type PaperOrderAttribution = {
  clientOrderId: string;
  botId: string;
  brokerTag: string;
  strategyVersion: number;
};

export function createPaperClientOrderId(botId: string, strategyVersion: number, nonce = crypto.randomUUID()) {
  const brokerTag = botToTag.get(botId);
  if (!brokerTag) throw new Error("Unknown paper bot profile.");
  if (!Number.isInteger(strategyVersion) || strategyVersion < 1) throw new Error("A positive strategy version is required.");
  const cleanNonce = safeNonce(nonce);
  if (cleanNonce.length < 6) throw new Error("Order nonce is too short.");
  const created = Date.now().toString(36);
  const value = `${PREFIX}-${brokerTag}-v${strategyVersion}-${created}-${cleanNonce}`;
  if (value.length > 128) throw new Error("Generated client order ID exceeds the execution venue limit.");
  return value;
}

export function parsePaperClientOrderId(clientOrderId: string): PaperOrderAttribution | null {
  if (typeof clientOrderId !== "string" || clientOrderId.length > 128) return null;
  const match = /^chb-([a-z0-9]{2,12})-v([1-9][0-9]*)-([a-z0-9]+)-([a-z0-9]{6,24})$/.exec(clientOrderId);
  if (!match) return null;
  const botId = tagToBot.get(match[1]);
  if (!botId) return null;
  const strategyVersion = Number(match[2]);
  if (!Number.isSafeInteger(strategyVersion) || strategyVersion < 1) return null;
  return {
    clientOrderId,
    botId,
    brokerTag: match[1],
    strategyVersion,
  };
}

export function isBotAttributedPaperOrder(clientOrderId: unknown): clientOrderId is string {
  return typeof clientOrderId === "string" && parsePaperClientOrderId(clientOrderId) !== null;
}
