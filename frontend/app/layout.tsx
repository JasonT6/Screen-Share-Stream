import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Private Stream",
  description:
    "Full-resolution screen sharing with audio. A private link, a password, and a direct connection."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem("private-stream-theme")==="dark"?"dark":"light"}catch{}`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
