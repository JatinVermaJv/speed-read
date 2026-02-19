import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { Navbar } from "@/components/layout/Navbar";
import { GoogleOAuthWrapper } from "@/components/layout/GoogleOAuthWrapper";

export const metadata: Metadata = {
  title: "Speed-Read | RSVP Speed Reading Trainer",
  description:
    "Train your reading speed with Rapid Serial Visual Presentation (RSVP) technique",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* Ambient background */}
        <div className="bg-mesh" aria-hidden="true" />
        <div className="bg-dots" aria-hidden="true" />

        <GoogleOAuthWrapper>
          <AuthProvider>
            <div className="relative z-10">
              <Navbar />
              <main className="flex-1">{children}</main>
            </div>
          </AuthProvider>
        </GoogleOAuthWrapper>
      </body>
    </html>
  );
}
