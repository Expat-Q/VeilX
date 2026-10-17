import React from "react";
import { UserCheck, ShieldAlert, Wallet, Check } from "lucide-react";

export function HowItWorksSection() {
  const steps = [
    {
      num: "01",
      title: "Target an X Account",
      desc: "Type any Twitter handle. VeilX verifies their immutable profile ID in real-time to guarantee you never tip an impersonator.",
    },
    {
      num: "02",
      title: "Fund with Shielded Zcash",
      desc: "Scan the dynamic ZIP-321 QR code or approve via Noir. Your funds enter an isolated shielded escrow address.",
    },
    {
      num: "03",
      title: "Recipient Claims Instantly",
      desc: "When the recipient joins VeilX and authenticates with X OAuth, they provide their wallet address and claim 100% of the funds.",
    },
  ];

  return (
    <section id="how-it-works" className="py-16 md:py-20 px-4 sm:px-6 bg-cream-100 border-t border-cream-200">
      <div className="max-w-6xl mx-auto space-y-12 text-left">
        <div className="max-w-2xl space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-gold-600">
            Frictionless Coordination
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-espresso-950 tracking-tight">
            How private tipping works.
          </h2>
          <p className="text-sm sm:text-base text-espresso-500 font-normal">
            No complex contracts. Just clean zero-knowledge settlement under the hood.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((s, idx) => (
            <div
              key={idx}
              className="p-6 bg-white border border-cream-300 rounded-3xl space-y-4 shadow-subtle relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl font-mono font-extrabold text-gold-500">
                  {s.num}
                </span>
                <span className="w-8 h-8 rounded-full bg-cream-100 flex items-center justify-center text-xs font-bold text-espresso-800 border border-cream-200">
                  ✓
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-espresso-950">{s.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-espresso-500">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
