import React from "react";
import Link from "next/link";
import { ArrowRight, Shield, Cpu, Lock, Globe } from "lucide-react";

export function Footer() {
  const partners = [
    {
      title: "Zcash Shielded",
      desc: "Private zero-knowledge cryptocurrency layer with zero on-chain address or amount visibility.",
      icon: Shield,
      href: "https://z.cash",
    },
    {
      title: "NU5 / Halo 2 Orchard",
      desc: "Latest Zcash network upgrade utilizing modern recursive Halo2 proving systems.",
      icon: Cpu,
      href: "https://z.cash/upgrade/nu5/",
    },
    {
      title: "Zallet Engine",
      desc: "Full-node Rust wallet daemon managing isolated ZIP-316 diversifiers per tip.",
      icon: Globe,
      href: "https://github.com/zcash/zallet",
    },
    {
      title: "𝕏 OAuth 2.0",
      desc: "Official Twitter API v2 integration anchoring tips strictly to immutable numeric IDs.",
      icon: Lock,
      href: "https://developer.twitter.com",
    },
  ];

  return (
    <footer className="w-full bg-white border-t border-butter-300 pt-16 pb-12 px-4 sm:px-6 text-left">
      <div className="max-w-6xl mx-auto space-y-16">
        {/* Top 4 Protocol Cards (Matching Screenshot 4) */}
        <div className="space-y-6">
          <p className="text-xs font-semibold text-brown-500 text-center sm:text-left">
            Built with modern infrastructure to deliver mathematical privacy on social rails.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {partners.map((p, i) => {
              const Icon = p.icon;
              return (
                <a
                  key={i}
                  href={p.href}
                  target="_blank"
                  rel="noreferrer"
                  className="p-5 rounded-3xl bg-butter-50 border border-butter-200 hover:border-butter-300 hover:shadow-subtle transition-all space-y-3 group block"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="w-5 h-5 text-brown-900" />
                      <h4 className="text-sm font-bold text-brown-950 group-hover:text-brown-700 transition-colors">
                        {p.title}
                      </h4>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-brown-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-xs text-brown-500 leading-relaxed">{p.desc}</p>
                </a>
              );
            })}
          </div>
        </div>

        {/* Bottom 3-Column Navigation (Matching Screenshot 4) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 pt-8 border-t border-butter-200">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <img
                src="/VeilX_logo.png"
                alt="VeilX Logo"
                className="w-8 h-8 rounded-lg object-contain bg-butter-50 border border-butter-200 p-0.5"
              />
              <span className="font-extrabold text-lg text-brown-950 tracking-tight">VeilX</span>
            </div>
            <p className="text-xs text-brown-500 max-w-xs leading-relaxed">
              Private payments for the social internet. Send, request, and claim shielded Zcash tips directly.
            </p>
          </div>

          <div className="space-y-2 text-xs">
            <p className="font-bold text-brown-950 uppercase tracking-wider text-[11px]">Explore</p>
            <ul className="space-y-1.5 text-brown-500 font-medium">
              <li><a href="#features" className="hover:text-brown-950">Private Tips</a></li>
              <li><a href="#capabilities" className="hover:text-brown-950">Private Requests</a></li>
              <li><a href="#capabilities" className="hover:text-brown-950">One-Time PayLinks</a></li>
              <li><a href="#faq" className="hover:text-brown-950">FAQ & Security</a></li>
            </ul>
          </div>

          <div className="space-y-2 text-xs">
            <p className="font-bold text-brown-950 uppercase tracking-wider text-[11px]">Connect</p>
            <ul className="space-y-1.5 text-brown-500 font-medium">
              <li><a href="https://x.com" target="_blank" rel="noreferrer" className="hover:text-brown-950">VeilX on 𝕏</a></li>
              <li><a href="https://z.cash" target="_blank" rel="noreferrer" className="hover:text-brown-950">Zcash Foundation</a></li>
              <li><a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-brown-950">GitHub Source</a></li>
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="pt-8 border-t border-butter-200 flex flex-col sm:flex-row items-center justify-between text-xs text-brown-400 gap-4">
          <p>© 2026 VeilX Protocol. Built for the privacy-first web.</p>
          <div className="flex gap-4">
            <a href="#" className="hover:text-brown-700">Terms</a>
            <a href="#" className="hover:text-brown-700">Privacy</a>
            <a href="#" className="hover:text-brown-700">Documentation</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
