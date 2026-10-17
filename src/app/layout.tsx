import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAF6EE",
};

export const metadata: Metadata = {
  title: "VeilX — Private Payments for the Social Internet",
  description:
    "VeilX — Private payments for the social internet. Tip creators, request payments, and generate shielded payment links directly for X identities using Zcash zero-knowledge cryptography.",
  icons: {
    icon: "/VeilX_logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-butter-100 text-brown-900 min-h-screen flex flex-col font-sans antialiased selection:bg-brown-900 selection:text-white">
        {children}
      </body>
    </html>
  );
}
