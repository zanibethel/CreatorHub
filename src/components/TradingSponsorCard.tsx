"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";
import styles from "./PaperTradingLab.module.css";

export const SPONSOR_SLOTS = [
  { id: "donate", title: "Support the stream", copy: "Donate to the creator. Donations are separate from the virtual portfolio." },
  { id: "ads", title: "Your ad here", copy: "Book a sponsor card on the stream." },
  { id: "raisehub", title: "RaiseHub", copy: "Explore RaiseHub." },
  { id: "cooperative", title: "CoOperative", copy: "Explore CoOperative." },
] as const;
export type SponsorLinks = Record<string, string>;

export function safeDestination(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.href.length > 256) return "";
    return url.href;
  } catch { return ""; }
}

function QR({ url }: { url: string }) {
  const code = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const size = qr.getModuleCount();
    const cells: string[] = [];
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) if (qr.isDark(row, col)) cells.push(`M${col + 4},${row + 4}h1v1h-1z`);
    return { size: size + 8, path: cells.join("") };
  }, [url]);
  return <div className={styles.qr}><svg viewBox={`0 0 ${code.size} ${code.size}`} role="img" aria-label={`QR code for ${url}`} shapeRendering="crispEdges"><rect width={code.size} height={code.size} fill="white" /><path d={code.path} fill="black" /></svg></div>;
}

export default function TradingSponsorCard({ links, index, onSetup }: { links: SponsorLinks; index: number; onSetup: () => void }) {
  const slots = SPONSOR_SLOTS.filter(slot => safeDestination(links[slot.id] ?? ""));
  const slot = slots.length ? slots[index % slots.length] : null;
  const url = slot ? safeDestination(links[slot.id]) : "";
  return <aside className={`${styles.card} ${styles.sponsor}`} aria-label="Stream sponsor card">
    <span className={styles.meta}>{slot?.id === "donate" ? "CREATOR SUPPORT" : "SPONSOR SPACE"}</span>
    <h2>{slot?.title ?? "Your stream, your community"}</h2>
    {slot ? <QR url={url} /> : <div className={styles.qrBlank}>QR space reserved</div>}
    <p>{slot?.copy ?? "Donations · ad bookings · RaiseHub · CoOperative when ready"}</p>
    {slot ? <a href={url} target="_blank" rel="noopener noreferrer">Scan or visit {new URL(url).hostname}</a> : <button onClick={onSetup}>Set QR destinations</button>}
    <span className={styles.meta}>{slot ? `Destination ${index % slots.length + 1}/${slots.length} · switches every 24 seconds` : "Add a link to enable its card"}</span>
  </aside>;
}
