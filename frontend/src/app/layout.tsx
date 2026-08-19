import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "PREV' INC & CIE — Plans d'intervention et d'évacuation",
  description: "Créez, annotez et exportez vos plans de sécurité incendie avec PREV' INC & CIE.",
  icons: {
    icon: "/prev-inc-cie-mark.png",
    shortcut: "/prev-inc-cie-mark.png",
    apple: "/prev-inc-cie-mark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="flex min-h-full w-full min-w-0 flex-col bg-white text-slate-950">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
