import type { CSSProperties } from "react";

export const colors = {
  background: "#0b0712",
  surface: "#151020",
  surfaceElevated: "#1c1429",
  border: "#312442",
  text: "#f7f2ff",
  muted: "#a99ab9",
  purple: "#8b5cf6",
  purpleBright: "#a78bfa",
  purpleSoft: "#24173a",
};

export const card: CSSProperties = {
  background: `linear-gradient(180deg, ${colors.surfaceElevated} 0%, ${colors.surface} 100%)`,
  border: `1px solid ${colors.border}`,
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 14px 40px rgba(0,0,0,.22)",
};

export const input: CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: `1px solid ${colors.border}`,
  boxSizing: "border-box",
  marginTop: 6,
  background: "#0f0a18",
  color: colors.text,
  outlineColor: colors.purple,
};

export const primaryButton: CSSProperties = {
  border: 0,
  borderRadius: 999,
  padding: "11px 16px",
  background: `linear-gradient(135deg, ${colors.purple} 0%, #6d28d9 100%)`,
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 8px 22px rgba(139,92,246,.24)",
};

export const secondaryButton: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 999,
  padding: "10px 15px",
  background: colors.purpleSoft,
  color: colors.text,
  fontWeight: 700,
  cursor: "pointer",
};
