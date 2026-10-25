"use client";

import React, { useState } from "react";
import { ArrowRight, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface FAQSectionProps {
  onLaunchApp?: () => void;
}

export function FAQSection({ onLaunchApp }: FAQSectionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const faqs = [
    {
      q: "Why does VeilX exist?",
      a: "VeilX bridges social distribution on Twitter/X with mathematical privacy on Zcash. You can tip any X account without exposing wallet addresses or amounts publicly.",
    },
    {
      q: "What is ZEC, and what can I do with it?",
      a: "ZEC is the native currency of Zcash. When held in shielded addresses, transfers are completely private and encrypted using zero-knowledge proofs.",
    },
    {
      q: "How does VeilX make tipping simpler?",
      a: "You don't need to ask for someone's Zcash address. Just enter their Twitter handle, send the tip, and they can claim it whenever they join.",
    },
    {
      q: "Are tip transactions instant?",
      a: "Tip creation is immediate. On-chain confirmation takes approximately 3 blocks (~3.75 minutes) on the Zcash network for irreversible settlement.",
    },
    {
      q: "Can I tip anonymously?",
      a: "Yes. Senders can choose to hide their X identity completely. The recipient will see 'From Anonymous Supporter' with your private memo.",
    },
    {
      q: "Who pays the transaction fees?",
      a: "The recipient pays the standard 0.0001 ZEC ZIP-317 network miner fee upon claiming funds to their private wallet. Tips must be at least 0.0002 ZEC so the recipient receives at least 0.0001 ZEC net payout.",
    },
    {
      q: "Does VeilX hold my private keys?",
      a: "Never. Senders pay from their own self-custodial wallets (like Zashi, YWallet, or Noir), and recipients claim directly to their own private addresses.",
    },
    {
      q: "Which wallets can I use with VeilX?",
      a: "You can use any shielded Zcash wallet, including Zashi, YWallet, Zingo!, or the Noir browser extension.",
    },
  ];

  return (
    <section id="faq" className="min-h-screen flex flex-col justify-center py-16 md:py-24 px-4 sm:px-6 bg-butter-100 border-t border-butter-200">
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start text-left">
        {/* Left Column: Headline & Dual CTAs (Matching Screenshot 5) */}
        <div className="lg:col-span-4 space-y-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brown-500">
            FAQS
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-extrabold text-brown-950 tracking-[-0.03em] leading-[1.1]">
            A few things you might want to know.
          </h2>
          <p className="text-sm text-brown-500 font-normal leading-relaxed">
            Private tips, Shielded Escrow, ZIP-321 and developer tools, explained simply.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Button
              onClick={onLaunchApp}
              size="md"
              variant="primary"
              className="gap-2 shadow-subtle"
            >
              <span>Launch App</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
            <a
              href="https://z.cash"
              target="_blank"
              rel="noreferrer"
              className="h-11 px-5 rounded-full border border-butter-300 bg-white text-brown-900 hover:bg-butter-50 font-semibold text-xs inline-flex items-center justify-center transition-all shadow-subtle"
            >
              About Zcash
            </a>
          </div>
        </div>

        {/* Right Column: 2-Column FAQ Accordion (Matching Screenshot 5) */}
        <div className="lg:col-span-8 bg-white border border-butter-300 rounded-[36px] p-6 sm:p-8 shadow-elevated">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {faqs.map((faq, idx) => {
              const isOpen = openIndex === idx;
              return (
                <div
                  key={idx}
                  className="border-b border-butter-200 pb-4 last:border-b-0"
                >
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-3 text-left py-2 group focus:outline-none"
                  >
                    <span className="text-xs font-bold text-brown-950 group-hover:text-brown-700 transition-colors">
                      {faq.q}
                    </span>
                    <span className="w-6 h-6 rounded-full border border-butter-300 flex items-center justify-center text-brown-500 shrink-0 group-hover:bg-butter-100 transition-all">
                      {isOpen ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    </span>
                  </button>

                  {isOpen && (
                    <p className="mt-2 text-xs text-brown-500 leading-relaxed animate-in fade-in-50 duration-150">
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
