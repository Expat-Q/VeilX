import React from "react";
import { AlertTriangle } from "lucide-react";

interface NetworkMismatchAlertProps {
  isNetworkMismatch?: boolean;
}

export function NetworkMismatchAlert({ isNetworkMismatch }: NetworkMismatchAlertProps) {
  if (!isNetworkMismatch) return null;

  return (
    <div className="p-3 bg-rose-50 border-2 border-rose-500 rounded-xl space-y-1 text-left animate-in fade-in shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-bold text-rose-950">
        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
        <span>🚨 Network Mismatch — Risk of Permanent Fund Loss</span>
      </div>
      <p className="text-[11px] text-rose-900 leading-relaxed">
        You entered a <strong>Testnet</strong> address, but VeilX is operating on <strong>Zcash Mainnet</strong>. Sending mainnet funds to a testnet address will result in permanent, irreversible loss of funds. Please enter a valid Mainnet address (<code className="font-mono bg-rose-100 px-1 py-0.5 rounded text-rose-950">u1...</code> or <code className="font-mono bg-rose-100 px-1 py-0.5 rounded text-rose-950">t1...</code>).
      </p>
    </div>
  );
}
