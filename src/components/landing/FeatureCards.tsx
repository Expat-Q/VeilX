import React from "react";
import { Send, Inbox, Link2, Shield, Lock, Zap } from "lucide-react";

export function FeatureCards() {
  const features = [
    {
      icon: Send,
      title: "1. Private Tips",
      tag: "Custodial Escrow",
      description:
        "Tip any X handle in seconds—even if they don't have a VeilX account yet. Funds wait securely in shielded escrow until claimed.",
      highlight: "Sender stays 100% anonymous on-chain.",
    },
    {
      icon: Inbox,
      title: "2. Private Requests",
      tag: "Direct Settlement",
      description:
        "Request ZEC directly from an X user with an optional invoice note. When approved, funds transfer straight wallet-to-wallet without escrow.",
      highlight: "Zero custody, instant settlement.",
    },
    {
      icon: Link2,
      title: "3. Private Payment Links",
      tag: "One-Time Invoices",
      description:
        "Create shareable one-time invoice links for commissions, freelance gigs, or donations. Payers don't even need an X account.",
      highlight: "ZIP-321 standardized QR codes.",
    },
  ];

  return (
    <section id="features" className="py-16 md:py-20 px-4 sm:px-6 bg-white/50 border-t border-cream-200/80">
      <div className="max-w-6xl mx-auto space-y-12 text-left">
        <div className="max-w-2xl space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-gold-600">
            Payment Primitives
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-espresso-950 tracking-tight">
            Three simple ways to move money.
          </h2>
          <p className="text-sm sm:text-base text-espresso-500 font-normal">
            Engineered around how people actually interact on social networks.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                className="p-6 bg-white border border-cream-300 rounded-3xl shadow-subtle hover:shadow-elevated transition-all space-y-4 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="w-11 h-11 rounded-2xl bg-cream-100 border border-cream-300 flex items-center justify-center text-espresso-900 shadow-subtle">
                      <Icon className="w-5 h-5 text-espresso-800" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-espresso-500 bg-cream-100 px-2.5 py-1 rounded-full border border-cream-200">
                      {f.tag}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-espresso-950">{f.title}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-espresso-500">
                      {f.description}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-cream-200 text-xs font-semibold text-espresso-800 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-gold-600 shrink-0" />
                  <span>{f.highlight}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
