"use client";

import React from "react";
import { ArrowRight } from "lucide-react";

export interface ProductListSectionProps {
  onLaunchApp?: () => void;
}

export function ProductListSection({
  onLaunchApp,
}: ProductListSectionProps) {
  const capabilities = [
    {
      num: "01",
      title: "Private Tips",
      badge: "EVERYDAY CREATOR SUPPORT",
      desc: "Send shielded ZEC to any Twitter handle. Funds wait in escrow until claimed.",
      action: "Send tip",
      onClick: onLaunchApp,
    },
    {
      num: "02",
      title: "Private Requests",
      badge: "DIRECT P2P SETTLEMENT",
      desc: "Request ZEC directly from an X user. Zero custody, peer-to-peer delivery.",
      action: "Request ZEC",
      onClick: onLaunchApp,
    },
    {
      num: "03",
      title: "Payment Links",
      badge: "ONE-TIME INVOICES",
      desc: "Generate shareable links for freelance work, digital sales, or commissions.",
      action: "Create link",
      onClick: onLaunchApp,
    },
    {
      num: "04",
      title: "Claim Portal",
      badge: "STANDARD ZIP-317 FEE",
      desc: "Recipients receive tips directly into their shielded wallet, paying only the standard 0.0001 ZEC network miner fee.",
      action: "Claim portal",
      onClick: onLaunchApp,
    },
    {
      num: "05",
      title: "Shielded Protocol",
      badge: "NU5 / HALO 2 ORCHARD",
      desc: "Powered by modern Halo 2 recursive zero-knowledge proofs on Zcash Mainnet.",
      action: "View protocol",
      href: "https://z.cash",
    },
    {
      num: "06",
      title: "Developer Tools",
      badge: "OPEN APIS",
      desc: "Build private social payments and tipbots directly into your own app or bot.",
      action: "API docs",
      onClick: onLaunchApp,
    },
  ];

  return (
    <section id="capabilities" className="min-h-screen flex flex-col justify-center py-16 md:py-24 px-4 sm:px-6 bg-butter-100 border-t border-butter-200">
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center text-left">
        {/* Left Headline (Centered Vertically at Left) */}
        <div className="lg:col-span-4 space-y-4 my-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brown-500">
            USE VEILX
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-extrabold text-brown-950 tracking-[-0.015em] leading-[1.26] sm:leading-[1.22]">
            For you, your audience and your next idea.
          </h2>
          <p className="text-sm text-brown-500 font-normal leading-relaxed">
            Use it yourself, accept payments for commissions, or build private settlements into your social tools.
          </p>
        </div>

        {/* Right Capability List (Matching Screenshot 3's white card with numbered rows) */}
        <div className="lg:col-span-8 bg-white border border-butter-300 rounded-[36px] p-6 sm:p-8 shadow-elevated divide-y divide-butter-200">
          {capabilities.map((item, idx) => (
            <div
              key={idx}
              className="py-5 first:pt-2 last:pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
            >
              <div className="flex items-start gap-4 min-w-0">
                <span className="text-xs font-mono font-bold text-brown-400 pt-0.5 shrink-0">
                  {item.num}
                </span>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-base font-bold text-brown-950">{item.title}</h4>
                    <span className="text-[10px] font-bold tracking-wider text-brown-500 uppercase bg-butter-100 px-2 py-0.5 rounded-full border border-butter-200">
                      {item.badge}
                    </span>
                  </div>
                  <p className="text-xs text-brown-500 leading-relaxed max-w-md">
                    {item.desc}
                  </p>
                </div>
              </div>

              <div className="shrink-0 pl-7 sm:pl-0">
                {item.href ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="h-9 px-4 rounded-full bg-brown-900 text-white hover:bg-brown-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-all shadow-subtle"
                  >
                    <span>{item.action}</span>
                    <ArrowRight className="w-3 h-3" />
                  </a>
                ) : (
                  <button
                    onClick={item.onClick}
                    className="h-9 px-4 rounded-full bg-brown-900 text-white hover:bg-brown-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-all shadow-subtle group-hover:shadow-elevated"
                  >
                    <span>{item.action}</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
