"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X, Shield } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface NavbarProps {
  user?: {
    name: string;
    username: string;
    profileImageUrl?: string;
  } | null;
  onLogin?: () => void;
  onLogout?: () => void;
  onOpenTip?: () => void;
}

export function Navbar({ user, onLogin, onLogout, onOpenTip }: NavbarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const network = (process.env.NEXT_PUBLIC_ZCASH_NETWORK || "mainnet").toLowerCase();
  const isMainnet = network === "mainnet";

  return (
    <header className="w-full bg-butter-100/95 backdrop-blur-md border-b border-butter-300 transition-all z-40 relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-4">
        {/* Brand Logo & Network Badge */}
        <div className="flex items-center gap-3 shrink-0">
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <img
              src="/VeilX_logo.png"
              alt="VeilX Logo"
              className="h-9 w-9 object-contain rounded-xl shadow-subtle group-hover:scale-105 transition-all bg-white p-0.5 border border-butter-300"
            />
            <span className="font-extrabold text-xl text-brown-950 tracking-tight">
              VeilX
            </span>
          </Link>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border tracking-wide uppercase ${
            isMainnet
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-amber-50 text-amber-800 border-amber-200"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isMainnet ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
            {isMainnet ? "Mainnet" : "Testnet"}
          </span>
        </div>

        {/* Center Floating Pill Menu (Desktop) */}
        <nav className="hidden md:flex items-center gap-1 bg-white/90 border border-butter-300/80 rounded-full px-4 py-1.5 shadow-subtle">
          <Link
            href="#features"
            className="px-3.5 py-1.5 text-xs font-semibold text-brown-700 hover:text-brown-950 rounded-full hover:bg-butter-100 transition-all"
          >
            Products
          </Link>
          <Link
            href="#capabilities"
            className="px-3.5 py-1.5 text-xs font-semibold text-brown-700 hover:text-brown-950 rounded-full hover:bg-butter-100 transition-all"
          >
            Capabilities
          </Link>
          <Link
            href="#how-it-works"
            className="px-3.5 py-1.5 text-xs font-semibold text-brown-700 hover:text-brown-950 rounded-full hover:bg-butter-100 transition-all"
          >
            Technology
          </Link>
          <Link
            href="#faq"
            className="px-3.5 py-1.5 text-xs font-semibold text-brown-700 hover:text-brown-950 rounded-full hover:bg-butter-100 transition-all"
          >
            FAQs
          </Link>
        </nav>

        {/* Right Action: Mobile Menu Icon on Mobile / Launch App on Desktop */}
        <div className="flex items-center gap-3">
          {/* Desktop Auth / Launch App */}
          <div className="hidden sm:flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2.5">
                {onOpenTip && (
                  <Button onClick={onOpenTip} size="sm" variant="primary">
                    <span>Send a Tip</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                )}
                <div className="flex items-center gap-2 pl-2 border-l border-butter-300">
                  <span className="text-xs font-bold text-brown-900">
                    @{user.username}
                  </span>
                  <button
                    onClick={onLogout}
                    className="w-8 h-8 rounded-full bg-brown-900 text-white flex items-center justify-center text-xs font-bold hover:bg-brown-950 transition-all shadow-subtle"
                    title="Logout"
                  >
                    {user.username.slice(0, 2).toUpperCase()}
                  </button>
                </div>
              </div>
            ) : (
              <Button
                onClick={onLogin}
                size="sm"
                variant="primary"
                className="gap-2 px-5 font-semibold text-xs"
              >
                <span>Launch App</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          {/* Mobile Nav Icon */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="sm:hidden p-2 rounded-xl text-brown-900 hover:bg-butter-200 active:scale-95 transition-all focus:outline-none border border-butter-300"
            aria-label="Toggle navigation menu"
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6 text-brown-950" />
            ) : (
              <Menu className="w-6 h-6 text-brown-950" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Slide-Down Drawer Menu */}
      {isMobileMenuOpen && (
        <div className="sm:hidden bg-butter-50 border-t border-butter-300 px-5 py-6 space-y-4 text-left animate-in slide-in-from-top-2 duration-200 shadow-elevated">
          <nav className="flex flex-col space-y-3">
            <Link
              href="#features"
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-sm font-semibold text-brown-800 hover:text-brown-950 py-1.5 transition-colors"
            >
              Products
            </Link>
            <Link
              href="#capabilities"
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-sm font-semibold text-brown-800 hover:text-brown-950 py-1.5 transition-colors"
            >
              Capabilities
            </Link>
            <Link
              href="#how-it-works"
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-sm font-semibold text-brown-800 hover:text-brown-950 py-1.5 transition-colors"
            >
              Technology
            </Link>
            <Link
              href="#faq"
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-sm font-semibold text-brown-800 hover:text-brown-950 py-1.5 transition-colors"
            >
              FAQs
            </Link>
          </nav>

          <div className="pt-2 border-t border-butter-200">
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                if (onLogin) onLogin();
              }}
              className="w-full h-11 rounded-full bg-brown-900 text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-brown-950 active:scale-95 transition-all shadow-subtle"
            >
              <span>Launch App</span>
              <ArrowRight className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
