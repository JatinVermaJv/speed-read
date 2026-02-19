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
        <GoogleOAuthWrapper>
          <AuthProvider>
            <Navbar />
            <main className="flex-1">{children}</main>
          </AuthProvider>
        </GoogleOAuthWrapper>
      </body>
    </html>
  );
}
