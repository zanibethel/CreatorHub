import { PAPER_BOT_PROFILES } from "./paper-bot-profiles";

const CLIENT_ORDER_ID = /^ch-([a-z0-9]{2,12})-v([1-9][0-9]*)-([a-z0-9-]{8,80})$/;

export type PaperBrokerAttribution = {
  botId: string;
  brokerTag: string;
  strategyVersion: number;
  nonce: string;
};

export function makePaperBotClientOrderId(
  brokerTag: string,
  strategyVersion: number,
  nonce = globalThis.crypto?.randomUUID?.(),
) {
  if (!/^[a-z0-9]{2,12}$/.test(brokerTag)) throw new Error("Invalid paper bot broker tag.");
  if (!Number.isInteger(strategyVersion) || strategyVersion < 1) throw new Error("Invalid paper strategy version.");
  if (!nonce || !/^[a-z0-9-]{8,80}$/i.test(nonce)) throw new Error("Invalid paper order nonce.");
  const normalized = nonce.toLowerCase();
  const value = `ch-${brokerTag}-v${strategyVersion}-${normalized}`;
  if (value.length > 128) throw new Error("Paper client order ID is too long.");
  return value;
}

export function parsePaperBotClientOrderId(value: string): PaperBrokerAttribution | null {
  const match = CLIENT_ORDER_ID.exec(value);
  if (!match) return null;
  const profile = PAPER_BOT_PROFILES.find(candidate => candidate.brokerTag === match[1]);
  if (!profile) return null;
  return {
    botId: profile.id,
    brokerTag: match[1],
    strategyVersion: Number(match[2]),
    nonce: match[3],
  };
}
