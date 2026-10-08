import type { Metadata } from "next";
import SignalDesk from "@/components/SignalDesk";

export const metadata: Metadata = {
  title: "Signal Desk | CreatorHub",
  description: "Live visual pipeline for automated market prospects, prepared orders, simulated executions, holdings, and declined setups.",
};

export default function SignalDeskPage() {
  return <SignalDesk />;
}
