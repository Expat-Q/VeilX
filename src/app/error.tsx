"use client";

import React, { useEffect } from "react";
import { AlertTriangle, RefreshCw, LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Client Error caught by ErrorBoundary:", error);
  }, [error]);

  const handleClearSessionAndReload = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      // ignore
    }
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen bg-butter-100 flex flex-col items-center justify-center p-6 text-center text-brown-950">
      <div className="w-full max-w-md bg-white border border-butter-300 rounded-[32px] p-8 shadow-modal space-y-5 animate-in fade-in">
        <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto shadow-subtle">
          <AlertTriangle className="w-8 h-8" />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-mono font-bold text-rose-600 uppercase tracking-widest">
            Application Error
          </span>
          <h2 className="text-2xl font-black text-brown-950 tracking-tight">
            Something went wrong
          </h2>
          <p className="text-xs text-brown-600 max-w-xs mx-auto leading-relaxed">
            {error?.message || "An unexpected error occurred while rendering the dashboard."}
          </p>
        </div>

        <div className="pt-2 space-y-2">
          <Button onClick={() => reset()} variant="primary" className="w-full h-11 text-xs font-bold gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </Button>

          <Button
            onClick={handleClearSessionAndReload}
            variant="outline"
            className="w-full h-11 text-xs font-bold gap-2 text-rose-700 hover:bg-rose-50 border-rose-200"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Clear Session & Return to Home</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
