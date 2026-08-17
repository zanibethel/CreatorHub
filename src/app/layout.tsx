import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CreatorHub",
  description: "Know what to create next."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "radial-gradient(circle at top right, rgba(124,58,237,.18), transparent 32%), linear-gradient(180deg, #0b0712 0%, #08060d 100%)",
          color: "#f7f2ff"
        }}
      >
        {children}
      </body>
    </html>
  );
}
