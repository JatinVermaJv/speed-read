"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { BookOpen, BarChart3, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";

export function Navbar() {
  const { user, logout, isLoading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-xl">
          <BookOpen className="w-6 h-6 text-primary" />
          <span>Speed-Read</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          <Link
            href="/reader"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Reader
          </Link>
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
            Dashboard
          </Link>

          {isLoading ? (
            <div className="w-20 h-9 rounded-lg bg-secondary animate-pulse" />
          ) : user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {user.name}
              </span>
              <button
                onClick={logout}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-muted-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-4 space-y-3">
          <Link
            href="/reader"
            className="block text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(false)}
          >
            Reader
          </Link>
          <Link
            href="/dashboard"
            className="block text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(false)}
          >
            Dashboard
          </Link>
          {user ? (
            <>
              <span className="block text-sm text-muted-foreground">
                {user.name}
              </span>
              <button
                onClick={() => {
                  logout();
                  setMobileOpen(false);
                }}
                className="block text-muted-foreground hover:text-foreground"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="block text-muted-foreground hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                Login
              </Link>
              <Link
                href="/register"
                className="block text-primary font-semibold"
                onClick={() => setMobileOpen(false)}
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
