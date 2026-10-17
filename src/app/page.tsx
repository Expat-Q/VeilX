"use client";

import React, { useState, useEffect } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { AppNavbar } from "@/components/layout/AppNavbar";
import { MobileNav } from "@/components/layout/MobileNav";
import { HeroSection } from "@/components/landing/HeroSection";
import { EcosystemTicker } from "@/components/landing/EcosystemTicker";
import { ShowcaseSection } from "@/components/landing/ShowcaseSection";
import { ProductListSection } from "@/components/landing/ProductListSection";
import { FAQSection } from "@/components/landing/FAQSection";
import { Footer } from "@/components/landing/Footer";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { TipModal } from "@/components/modals/TipModal";
import { RequestModal } from "@/components/modals/RequestModal";
import { PayLinkModal } from "@/components/modals/PayLinkModal";
import { ClaimModal } from "@/components/modals/ClaimModal";
import { LoginModal } from "@/components/auth/LoginModal";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

export default function Home() {
  const [user, setUser] = useState<{
    name: string;
    username: string;
    profileImageUrl?: string;
    referralCount?: number;
    referralRewardsZec?: number;
    referralPoints?: number;
  } | null>(null);

  // Modal open states
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isTipOpen, setIsTipOpen] = useState(false);
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [isPayLinkOpen, setIsPayLinkOpen] = useState(false);
  const [selectedClaimTip, setSelectedClaimTip] = useState<any | null>(null);
  const [batchClaimTips, setBatchClaimTips] = useState<any[] | null>(null);



  // Mobile active tab state
  const [mobileTab, setMobileTab] = useState<"home" | "tips" | "requests" | "links" | "profile">("home");
  const [refreshKey, setRefreshKey] = useState(0);

  // Check current session on mount
  useEffect(() => {
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
      .catch((e) => console.warn("Session check error:", e));
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
    } catch (e) {
      setUser(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between">
      {/* Top Navbar: Guest Landing Navbar or Authenticated App Top Nav */}
      {!user ? (
        <Navbar
          onLogin={() => setIsLoginOpen(true)}
          onOpenTip={() => setIsTipOpen(true)}
        />
      ) : (
        <ErrorBoundary fallbackTitle="Navbar Error">
          <AppNavbar user={user} onLogout={handleLogout} />
        </ErrorBoundary>
      )}

      {/* Main View: Landing Page or Authenticated Dashboard */}
      <main className="flex-1 pb-16 md:pb-0">
        {!user ? (
          <div className="space-y-0">
            {/* 1. Hero Section */}
            <HeroSection onLaunchApp={() => setIsLoginOpen(true)} />

            {/* 2. Ecosystem Ticker */}
            <EcosystemTicker />

            {/* 3. Showcase Section (Scan-to-Settle Card + Split Capabilities) */}
            <ShowcaseSection onLaunchApp={() => setIsLoginOpen(true)} />

            {/* 4. Numbered Capability Rows (01 to 06) */}
            <ProductListSection
              onLaunchApp={() => setIsLoginOpen(true)}
            />

            {/* 5. 2-Column FAQ Accordion */}
            <FAQSection onLaunchApp={() => setIsLoginOpen(true)} />
          </div>
        ) : (
          <div className="py-4">
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
          </div>
        )}
      </main>

      {/* Footer (Only on Landing Page for Guests) */}
      {!user && <Footer />}

      {/* Mobile Bottom Navigation Bar (Only in Authenticated App Mode) */}
      {user && (
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
      )}

      {/* Authentication Login Modal */}
      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onSuccess={(loggedUser) => {
          setUser(loggedUser);
        }}
      />

      {/* Payment Modals */}
      <TipModal
        isOpen={isTipOpen}
        onClose={() => {
          setIsTipOpen(false);
          setMobileTab("home");
        }}
      />

      <RequestModal
        isOpen={isRequestOpen}
        onClose={() => {
          setIsRequestOpen(false);
          setMobileTab("home");
        }}
      />

      <PayLinkModal
        isOpen={isPayLinkOpen}
        onClose={() => {
          setIsPayLinkOpen(false);
          setMobileTab("home");
        }}
      />

      <ClaimModal
        isOpen={!!selectedClaimTip || !!batchClaimTips}
        tip={selectedClaimTip}
        tipsToBatchClaim={batchClaimTips}
        onClose={() => {
          setSelectedClaimTip(null);
          setBatchClaimTips(null);
          setMobileTab("home");
          setRefreshKey((k) => k + 1);
        }}
        onClaimSuccess={() => {
          // Keep modal open to show transaction hash and operation ID; reset occurs when user clicks Done
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}

