"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-6 text-center text-brown-950">
      <div className="w-full max-w-md bg-white border border-butter-300 rounded-[32px] p-8 shadow-modal space-y-5 animate-in fade-in zoom-in-95">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto shadow-subtle">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-mono font-bold text-brown-400 uppercase tracking-widest">
            Error 404
          </span>
          <h1 className="text-2xl font-black text-brown-950 tracking-tight">
            Page Not Found
          </h1>
          <p className="text-xs text-brown-600 max-w-xs mx-auto leading-relaxed">
            The page or payment route you are looking for does not exist or has been moved.
          </p>
        </div>

        <div className="pt-2 space-y-2">
          <Link href="/">
            <Button variant="primary" className="w-full h-11 text-xs font-bold gap-2">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to Home</span>
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" className="w-full h-11 text-xs font-bold">
              Open Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
