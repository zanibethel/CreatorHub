import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CreatorHub",
  description: "Know what to create next."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif", background: "#f6f7f9", color: "#15171a" }}>
        {children}
      </body>
    </html>
  );
}
