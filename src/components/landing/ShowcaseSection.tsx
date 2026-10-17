import React from "react";
import { ArrowRight, QrCode, Shield, Zap, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface ShowcaseSectionProps {
  onLaunchApp?: () => void;
}

export function ShowcaseSection({ onLaunchApp }: ShowcaseSectionProps) {
  return (
    <section id="features" className="min-h-screen flex flex-col justify-center py-16 md:py-24 px-4 sm:px-6 bg-butter-100">
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center text-left">
        {/* Left: Large Dark Rounded Feature Card (Matching Screenshot 2) */}
        <div className="lg:col-span-7 bg-brown-900 text-white border border-brown-800 rounded-[36px] p-8 sm:p-12 shadow-elevated space-y-6 flex flex-col justify-between min-h-[380px]">
          <div className="space-y-4">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-butter-300">
              VEILX · SCAN TO SETTLE
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-[44px] font-extrabold tracking-[-0.01em] leading-[1.28] sm:leading-[1.22]">
              One identity. One shielded QR. <br />
              Zero public trace.
            </h2>
            <p className="text-sm sm:text-base text-brown-300 max-w-md font-normal leading-relaxed tracking-normal">
              Tip any X user before they even join VeilX. Let them claim 100% of their ZEC using their personal Zcash wallet whenever they are ready.
            </p>
          </div>

          <div className="pt-4">
            <button
              onClick={onLaunchApp}
              className="h-12 px-6 rounded-full bg-white text-brown-950 hover:bg-butter-50 font-semibold text-sm inline-flex items-center gap-2.5 transition-all shadow-subtle group"
            >
              <span>Launch App</span>
              <div className="w-6 h-6 rounded-full bg-brown-900 text-white flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </button>
          </div>
        </div>

        {/* Right: Stacked Clean Interactive Feature Panels (Matching Screenshot 2) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Tile 1 */}
          <div className="p-6 bg-white border border-butter-300 rounded-3xl shadow-subtle flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-butter-100 border border-butter-200 flex items-center justify-center text-brown-900 shrink-0">
              <QrCode className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-bold text-brown-950">Dynamic ZIP-321 QR Handoff</h4>
              <p className="text-xs text-brown-500 leading-relaxed">
                Scan with mobile wallets like Zodl or Ywallet with prefilled amounts and memos.
              </p>
            </div>
          </div>

          {/* Tile 2 */}
          <div className="p-6 bg-white border border-butter-300 rounded-3xl shadow-subtle flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-butter-100 border border-butter-200 flex items-center justify-center text-brown-900 shrink-0">
              <Lock className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-bold text-brown-950">Encrypted Notes & Identities</h4>
              <p className="text-xs text-brown-500 leading-relaxed">
                Transactions settle in the Ironwood shielded pool with zero address leakage.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
