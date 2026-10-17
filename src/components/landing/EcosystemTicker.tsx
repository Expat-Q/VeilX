import React from "react";
import { Shield, Lock, Cpu, Globe, CheckCircle, Sparkles, Binary, Zap } from "lucide-react";

export function EcosystemTicker() {
  const tickerItems = [
    { label: "SECURED BY ZCASH", icon: Shield },
    { label: "ZK-SNARKS PRIVACY", icon: Sparkles },
    { label: "ZERO-KNOWLEDGE HALO2", icon: CheckCircle },
    { label: "IRONWOOD NU6.3", icon: Cpu },
    { label: "X OAUTH 2.0 PKCE", icon: Lock },
    { label: "SHIELDED ORCHARD & SAPLING", icon: Binary },
    { label: "NOIR EXTENSION READY", icon: Globe },
    { label: "ZODL & ZIP-321 COMPATIBLE", icon: Zap },
  ];

  // Duplicate list to create a seamless infinite loop
  const displayItems = [...tickerItems, ...tickerItems];

  return (
    <div className="w-full border-y border-butter-300 bg-[#FAF6EE]/80 py-3.5 overflow-hidden backdrop-blur-sm relative select-none">
      {/* Subtle edge fade overlays */}
      <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-[#FAF6EE] to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-[#FAF6EE] to-transparent z-10 pointer-events-none" />

      {/* Marquee Track */}
      <div className="animate-marquee flex items-center gap-8 text-[11px] sm:text-xs font-bold text-brown-900 tracking-wider uppercase">
        {displayItems.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className="flex items-center gap-2.5 shrink-0 px-2 group cursor-default transition-colors hover:text-brown-950"
            >
              <Icon className="w-4 h-4 text-brown-800 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="whitespace-nowrap">{item.label}</span>
              <span className="text-butter-400 font-bold ml-4">·</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
