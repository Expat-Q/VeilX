"use client";

import React, { useState } from "react";
import { ShieldCheck, CheckCircle2, ArrowRight, Lock, Zap } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { useZecPrice } from "@/lib/price-service";

export function InteractivePreviewCard() {
  const [step, setStep] = useState<"card" | "sent">("card");
  const { formatZecToUsd } = useZecPrice();

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Outer Floating Shell */}
      <div className="relative bg-white border border-butter-300 rounded-3xl p-6 sm:p-7 shadow-elevated transition-all duration-300 hover:shadow-card-hover">
        {/* Top Status Header */}
        <div className="flex items-center justify-between gap-2 pb-4 mb-4 border-b border-butter-200">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-brown-900 tracking-tight uppercase">
              Shielded Escrow Live
            </span>
          </div>
          <span className="text-[11px] font-mono font-semibold text-brown-500 bg-butter-100 px-2 py-0.5 rounded-md border border-butter-200">
            NU6.3 Ironwood
          </span>
        </div>

        {step === "card" ? (
          <div className="space-y-4">
            {/* Recipient Preview */}
            <div className="p-3.5 bg-butter-50 border border-butter-200 rounded-2xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar name="Zooko Wilcox" size="md" />
                <div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-brown-950">Zooko Wilcox</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-brown-800" />
                  </div>
                  <p className="text-[11px] font-medium text-brown-500">@zooko</p>
                </div>
              </div>
              <StatusBadge status="PENDING" />
            </div>

            {/* Amount Box */}
            <div className="p-4 bg-white border border-butter-200 rounded-2xl text-center space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-brown-400">
                Tip Amount
              </p>
              <p className="text-3xl font-mono font-bold text-brown-950 tracking-tight">
                0.25 ZEC
              </p>
              <p className="text-xs font-medium text-brown-500 font-mono">
                ≈ {formatZecToUsd(0.25)} USD
              </p>
            </div>

            {/* Privacy Tag */}
            <div className="flex items-center gap-2 text-xs text-brown-600 bg-butter-100/50 p-2.5 rounded-xl border border-butter-200">
              <Lock className="w-4 h-4 text-brown-700 shrink-0" />
              <span>Sender identity is <strong>100% private & shielded</strong> on-chain.</span>
            </div>

            {/* Primary Action */}
            <Button
              onClick={() => setStep("sent")}
              variant="primary"
              className="w-full gap-2 text-sm font-semibold h-12"
            >
              <span>Send 0.25 ZEC Tip</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="py-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-200 mx-auto flex items-center justify-center">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-lg font-bold text-brown-950">Tip Funded in Escrow!</h4>
              <p className="text-xs text-brown-500 mt-1 max-w-xs mx-auto">
                0.25 ZEC is safely waiting in shielded escrow for <strong>@zooko</strong> to claim.
              </p>
            </div>
            <div className="pt-2">
              <Button
                onClick={() => setStep("card")}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                Replay Preview
              </Button>
            </div>
          </div>
        )}

        {/* Footer Note */}
        <div className="mt-4 pt-3 border-t border-butter-200 flex items-center justify-between text-[11px] text-brown-400">
          <span>Zero linkability on-chain</span>
          <span className="font-semibold text-brown-600">ZIP-316 Diversifier</span>
        </div>
      </div>
    </div>
  );
}
