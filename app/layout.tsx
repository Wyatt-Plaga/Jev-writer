import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev Writer",
  description: "A writing editor that suggests what your next sentence should do.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
