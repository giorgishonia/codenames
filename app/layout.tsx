import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "საიდუმლო სიტყვა — ქართული ონლაინ თამაში",
  description:
    "გუნდური სიტყვების თამაში მეგობრებისთვის — ლობი, რეალურ დროში თამაში და ავტომატური დაბრუნება.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ka">
      <body>{children}</body>
    </html>
  );
}
