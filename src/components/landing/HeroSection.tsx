"use client";

import React from "react";
import { ArrowRight, ShieldCheck, Lock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { useZecPrice } from "@/lib/price-service";

export interface HeroSectionProps {
  onLaunchApp?: () => void;
  onExplore?: () => void;
}

export function HeroSection({ onLaunchApp, onExplore }: HeroSectionProps) {
  const { formatZecToUsd } = useZecPrice();

  return (
    <section className="relative min-h-[calc(100vh-5rem)] flex flex-col justify-center py-12 px-4 sm:px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left Column: Copy & Dual Pill Buttons */}
          <div className="lg:col-span-7 space-y-6 text-left">
            {/* Spaced Kicker */}
            <p className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.18em] text-brown-500">
              VeilX · Private Payments for the Social Internet
            </p>

            {/* Massive Bold Headline */}
            <h1 className="text-4xl sm:text-6xl lg:text-[68px] font-extrabold text-brown-950 tracking-[-0.015em] leading-[1.22] sm:leading-[1.16] lg:leading-[1.12]">
              Move money on 𝕏. <br />
              <span className="text-brown-800">
                Keep finances private.
              </span>
            </h1>

            {/* Clean Subtitle */}
            <p className="text-base sm:text-lg text-brown-500 max-w-xl font-normal leading-relaxed tracking-normal">
              Send shielded Zcash, tip creators anonymously, and coordinate direct payment requests for any X identity. Powered by Zcash zero-knowledge cryptography.
            </p>

            {/* Dual Pill Action Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
              <Button
                onClick={onLaunchApp}
                size="lg"
                variant="primary"
                className="w-full sm:w-auto gap-2.5 shadow-elevated hover:shadow-card-hover text-sm font-semibold h-12 justify-center"
              >
                <span>Launch App</span>
                <ArrowRight className="w-4 h-4" />
              </Button>

              <a
                href="#features"
                className="h-12 px-7 rounded-full border border-butter-300 bg-white text-brown-900 hover:bg-butter-50 font-semibold text-sm inline-flex items-center justify-center transition-all shadow-subtle text-center"
              >
                How it works
              </a>
            </div>
          </div>

          {/* Right Column: Hero Visual Card */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="relative w-full max-w-md bg-white border border-butter-300 rounded-[36px] p-7 shadow-elevated hover:shadow-card-hover transition-all duration-300 space-y-5 text-left">
              {/* Card Header */}
              <div className="flex items-center justify-between pb-4 border-b border-butter-200">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold text-brown-900 uppercase tracking-tight">
                    Shielded Escrow Live
                  </span>
                </div>
                <span className="text-[11px] font-mono font-bold text-brown-500 bg-butter-100 px-2.5 py-1 rounded-full border border-butter-300">
                  NU5 Halo 2 Orchard
                </span>
              </div>

              {/* Verified Recipient Box */}
              <div className="p-4 bg-butter-50 border border-butter-200 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name="Zooko Wilcox" size="md" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-brown-950">Zooko Wilcox</span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-brown-800" />
                    </div>
                    <p className="text-[11px] font-medium text-brown-500">@zooko</p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-brown-900 bg-white px-2.5 py-1 rounded-full border border-butter-300 shadow-subtle">
                  Verified 𝕏 ID
                </span>
              </div>

              {/* Amount Display with Dynamic Live Price */}
              <div className="p-5 bg-white border border-butter-200 rounded-2xl text-center space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-brown-400">
                  Total Shielded Tip
                </p>
                <p className="text-4xl font-mono font-extrabold text-brown-950 tracking-tight">
                  0.25 <span className="text-xl font-bold text-brown-700">ZEC</span>
                </p>
                <p className="text-xs font-medium text-brown-500 font-mono">
                  ≈ {formatZecToUsd(0.25)} USD
                </p>
              </div>

              {/* Security Pill Tag */}
              <div className="flex items-center gap-2 text-xs text-brown-700 bg-butter-100/60 p-3 rounded-2xl border border-butter-300">
                <Lock className="w-4 h-4 text-brown-800 shrink-0" />
                <span>Zero on-chain linkability. Sender address is 100% encrypted.</span>
              </div>

              {/* Card Action Button */}
              <Button
                onClick={onLaunchApp}
                variant="primary"
                className="w-full h-12 text-sm font-semibold gap-2 justify-center"
              >
                <span>Launch App to Tip</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
