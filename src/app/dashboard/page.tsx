"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ShieldCheck, LogIn, Sparkles } from "lucide-react";
import { AppNavbar } from "@/components/layout/AppNavbar";
import { MobileNav } from "@/components/layout/MobileNav";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { TipModal } from "@/components/modals/TipModal";
import { RequestModal } from "@/components/modals/RequestModal";
import { PayLinkModal } from "@/components/modals/PayLinkModal";
import { ClaimModal } from "@/components/modals/ClaimModal";
import { LoginModal } from "@/components/auth/LoginModal";
import { ConnectedSuccessModal } from "@/components/modals/ConnectedSuccessModal";
import { Button } from "@/components/ui/Button";
import { XLogo } from "@/components/ui/XLogo";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{
    name: string;
    username: string;
    profileImageUrl?: string;
    referralCount?: number;
    referralRewardsZec?: number;
    referralPoints?: number;
  } | null>(null);

  const [isLoadingSession, setIsLoadingSession] = useState(true);

  // Modals
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isTipOpen, setIsTipOpen] = useState(false);
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [isPayLinkOpen, setIsPayLinkOpen] = useState(false);
  const [selectedClaimTip, setSelectedClaimTip] = useState<any | null>(null);
  const [batchClaimTips, setBatchClaimTips] = useState<any[] | null>(null);
  const [isConnectedSuccessOpen, setIsConnectedSuccessOpen] = useState(false);

  // Mobile navigation tab
  const [mobileTab, setMobileTab] = useState<"home" | "tips" | "requests" | "links" | "profile">("home");
  const [refreshKey, setRefreshKey] = useState(0);

  // Check current session
  useEffect(() => {
    // Check if user just returned from successful X OAuth connection
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("connected") === "true" || params.get("connected") === "1") {
        setIsConnectedSuccessOpen(true);
        const url = new URL(window.location.href);
        url.searchParams.delete("connected");
        window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
      }
    }

    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          const raw = data.user;
          const safeName = raw.xDisplayName || raw.name || raw.xUsername || raw.username || "Creator";
          const safeUsername = raw.xUsername || raw.username || "creator";
          setUser({
            name: safeName,
            username: safeUsername,
            profileImageUrl: raw.profileImageUrl,
            referralCount: typeof raw.referralCount === "number" ? raw.referralCount : 0,
            referralRewardsZec: typeof raw.referralRewardsZec === "number" ? raw.referralRewardsZec : 0,
            referralPoints: typeof raw.referralPoints === "number" ? raw.referralPoints : 0,
          });
        }
      })
      .catch((e) => console.warn("Session check error on /dashboard:", e))
      .finally(() => {
        setIsLoadingSession(false);
      });
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      router.push("/");
    } catch (e) {
      setUser(null);
      router.push("/");
    }
  };


  if (isLoadingSession) {
    return (
      <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-6 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-brown-800" />
        <p className="text-xs font-bold text-brown-600 uppercase tracking-wider font-mono">
          Loading VeilX Dashboard...
        </p>
      </div>
    );
  }

  // GUEST STATE ON /dashboard: Friendly prompt to authenticate with 𝕏
  if (!user) {
    return (
      <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-4 sm:p-6 text-center">
        <div className="w-full max-w-md bg-white border border-butter-300 rounded-[32px] p-6 sm:p-8 shadow-modal space-y-6 animate-in fade-in zoom-in-95">
          <div className="w-16 h-16 rounded-2xl bg-brown-900 text-white flex items-center justify-center mx-auto shadow-elevated">
            <ShieldCheck className="w-8 h-8 text-butter-200" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-black text-brown-950 tracking-tight">
              VeilX Creator Dashboard
            </h2>
            <p className="text-xs text-brown-600 leading-relaxed max-w-xs mx-auto">
              Sign in with your 𝕏 (Twitter) account to view incoming shielded tips, create payment requests, and claim your escrow balance.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <Button
              onClick={() => setIsLoginOpen(true)}
              variant="primary"
              className="w-full h-12 text-sm font-bold gap-2 shadow-elevated"
            >
              <XLogo className="w-4 h-4 fill-current text-white shrink-0" />
              <span>Sign In with 𝕏 to Open Dashboard</span>
            </Button>
          </div>

          <div className="pt-2 border-t border-butter-200">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brown-600 hover:text-brown-950 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Home Landing Page</span>
            </Link>
          </div>
        </div>

        {/* Authentication Modal */}
        <LoginModal
          isOpen={isLoginOpen}
          onClose={() => setIsLoginOpen(false)}
          onSuccess={(loggedUser) => setUser(loggedUser)}
        />
      </div>
    );
  }

  // AUTHENTICATED DASHBOARD VIEW
  return (
    <div className="min-h-screen flex flex-col justify-between bg-butter-100 text-brown-900">
      <ErrorBoundary fallbackTitle="Navbar Error">
        <AppNavbar user={user} onLogout={handleLogout} />
      </ErrorBoundary>

      <main className="flex-1 py-4 pb-20 md:pb-6">
        <ErrorBoundary fallbackTitle="Dashboard Rendering Error">
          <DashboardOverview
            key={refreshKey}
            user={user}
            onOpenTip={() => setIsTipOpen(true)}
            onOpenRequest={() => setIsRequestOpen(true)}
            onOpenPayLink={() => setIsPayLinkOpen(true)}
            onOpenClaim={(tip) => setSelectedClaimTip(tip)}
            onOpenBatchClaim={(tips) => setBatchClaimTips(tips)}
            onLogout={handleLogout}
          />
        </ErrorBoundary>
      </main>

      {/* Mobile Navigation */}
      <MobileNav
        activeTab={mobileTab}
        onSelectTab={(tab) => {
          setMobileTab(tab);
          if (tab === "tips") setIsTipOpen(true);
          if (tab === "requests") setIsRequestOpen(true);
          if (tab === "links") setIsPayLinkOpen(true);
        }}
        onOpenTip={() => setIsTipOpen(true)}
      />

      {/* Payment Modals */}
      <TipModal isOpen={isTipOpen} onClose={() => setIsTipOpen(false)} />

      <RequestModal isOpen={isRequestOpen} onClose={() => setIsRequestOpen(false)} />

      <PayLinkModal isOpen={isPayLinkOpen} onClose={() => setIsPayLinkOpen(false)} />

      <ClaimModal
        isOpen={!!selectedClaimTip || !!batchClaimTips}
        tip={selectedClaimTip}
        tipsToBatchClaim={batchClaimTips}
        onClose={() => {
          setSelectedClaimTip(null);
          setBatchClaimTips(null);
          setRefreshKey((k) => k + 1);
        }}
        onClaimSuccess={() => {
          // Keep modal open to show transaction hash and operation ID; reset occurs when user clicks Done
          setRefreshKey((k) => k + 1);
        }}
      />

      {/* 𝕏 Account Binding Confirmation Modal */}
      <ConnectedSuccessModal
        isOpen={isConnectedSuccessOpen}
        onClose={() => setIsConnectedSuccessOpen(false)}
        user={user}
      />
    </div>
  );
}
