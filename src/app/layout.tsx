import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Da Silva OS", template: "%s · Da Silva OS" },
  description: "Sistema operativo privado de Da Silva Automotores",
  robots: { index: false, follow: false },
  // Sin ícono propio hasta incorporar el logo original (public/brand/README.md).
  icons: { icon: "data:," },
};

export const viewport: Viewport = {
  themeColor: "#101113",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PY">
      <body className="min-h-dvh">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
