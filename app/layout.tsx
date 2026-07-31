import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "საიდუმლო სიტყვა — ქართული ონლაინ თამაში",
  description:
    "გუნდური სიტყვების თამაში მეგობრებისთვის — ლობი, რეალურ დროში თამაში და ავტომატური დაბრუნება.",
  icons: {
    icon: "/saidumlo-logo.png?v=1",
    shortcut: "/saidumlo-logo.png?v=1",
    apple: "/saidumlo-logo.png?v=1",
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
