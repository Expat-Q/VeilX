"use client";

import React, { useState } from "react";
import { Download, ShieldCheck, Check, ExternalLink, Receipt, Clock } from "lucide-react";
import { Button } from "./Button";
import { truncateAddress, getZcashExplorerUrl } from "@/lib/utils";

export interface InvoiceReceiptCardProps {
  type: "tip" | "request" | "paylink";
  recipientUsername: string;
  recipientName?: string;
  amountZec: number | string;
  amountUsd?: string;
  txid?: string;
  escrowAddress?: string;
  memo?: string;
  date?: Date;
  isAnonymous?: boolean;
  payerUsername?: string;
}

export function InvoiceReceiptCard({
  type,
  recipientUsername,
  recipientName,
  amountZec,
  amountUsd,
  txid,
  escrowAddress,
  memo,
  date = new Date(),
  isAnonymous,
  payerUsername,
}: InvoiceReceiptCardProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const cleanHandle = recipientUsername.replace("@", "");
  const formattedDate = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const receiptId = txid
    ? `VLX-${txid.slice(0, 8).toUpperCase()}`
    : `VLX-${Date.now().toString(36).toUpperCase()}`;

  const typeLabel =
    type === "tip"
      ? "Creator Escrow Tip"
      : type === "request"
      ? "Payment Request Settlement"
      : "PayLink Invoice Settlement";

  /**
   * Generates a high-resolution 1200x800 PNG receipt using HTML5 Canvas
   */
  const handleDownload = () => {
    setIsGenerating(true);

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 760;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Could not initialize canvas context");
      }

      // 1. Background Fill (Warm Butter Cream)
      ctx.fillStyle = "#FBF9F1";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Outer Border (Classic Warm Gold)
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#E5DCC3";
      ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

      // 3. Header Card Banner
      ctx.fillStyle = "#261C14"; // Dark rich espresso
      ctx.beginPath();
      ctx.roundRect(40, 40, canvas.width - 80, 110, 16);
      ctx.fill();

      // Header Brand Text
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 38px sans-serif";
      ctx.fillText("VeilX", 70, 105);

      ctx.fillStyle = "#E5DCC3";
      ctx.font = "bold 18px monospace";
      ctx.fillText("SHIELDED ESCROW PAYMENT RECEIPT", 185, 85);

      ctx.font = "14px monospace";
      ctx.fillText(`RECEIPT #${receiptId}  •  ${formattedDate}`, 185, 115);

      // Status Badge (Top Right)
      ctx.fillStyle = "#10B981"; // Emerald
      ctx.beginPath();
      ctx.roundRect(canvas.width - 260, 68, 180, 48, 24);
      ctx.fill();

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("✓ CONFIRMED", canvas.width - 170, 98);
      ctx.textAlign = "left"; // Reset

      // 4. Main Receipt Body (White Card)
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.roundRect(40, 170, canvas.width - 80, 460, 20);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#EAE2CC";
      ctx.stroke();

      // Type Label
      ctx.fillStyle = "#8C7B6B";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(typeLabel.toUpperCase(), 80, 220);

      // Main Amount Display
      ctx.fillStyle = "#261C14";
      ctx.font = "bold 52px monospace";
      ctx.fillText(`${amountZec} ZEC`, 80, 280);

      if (amountUsd) {
        ctx.fillStyle = "#059669";
        ctx.font = "bold 22px sans-serif";
        ctx.fillText(`≈ ${amountUsd} USD`, 80, 318);
      }

      // Divider Line
      ctx.strokeStyle = "#F0EAD6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(80, 345);
      ctx.lineTo(canvas.width - 80, 345);
      ctx.stroke();

      // Details Columns
      const leftCol = 80;
      const rightCol = 650;

      // Row 1: Recipient & Payer
      ctx.fillStyle = "#736456";
      ctx.font = "15px sans-serif";
      ctx.fillText("Recipient:", leftCol, 385);
      ctx.fillStyle = "#261C14";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(`@${cleanHandle} ${recipientName ? `(${recipientName})` : ""}`, leftCol, 415);

      ctx.fillStyle = "#736456";
      ctx.font = "15px sans-serif";
      ctx.fillText("Payer:", rightCol, 385);
      ctx.fillStyle = "#261C14";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(isAnonymous ? "Anonymous Supporter (Shielded)" : `@${payerUsername || "Supporter"}`, rightCol, 415);

      // Row 2: Memo & Network
      ctx.fillStyle = "#736456";
      ctx.font = "15px sans-serif";
      ctx.fillText("Memo / Purpose:", leftCol, 465);
      ctx.fillStyle = "#261C14";
      ctx.font = "italic 18px sans-serif";
      const cleanMemo = memo?.trim() ? `"${memo.trim().slice(0, 45)}"` : "VeilX Shielded Escrow Settlement";
      ctx.fillText(cleanMemo, leftCol, 495);

      ctx.fillStyle = "#736456";
      ctx.font = "15px sans-serif";
      ctx.fillText("Settlement Network:", rightCol, 465);
      ctx.fillStyle = "#261C14";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText("Zcash Mainnet (NU5 / Orchard Pool)", rightCol, 495);

      // Row 3: On-Chain Proof
      ctx.fillStyle = "#736456";
      ctx.font = "15px sans-serif";
      ctx.fillText("Transaction Hash (TxID):", leftCol, 545);
      ctx.fillStyle = "#1E3A8A"; // Blue
      ctx.font = "16px monospace";
      const displayTxid = txid || "Pending on-chain verification";
      ctx.fillText(displayTxid, leftCol, 575);

      ctx.fillStyle = "#736456";
      ctx.font = "15px sans-serif";
      ctx.fillText("Miner Network Fee:", rightCol, 545);
      ctx.fillStyle = "#261C14";
      ctx.font = "bold 18px monospace";
      ctx.fillText("0.00010000 ZEC", rightCol, 575);

      // 5. Security & Verification Footer
      ctx.fillStyle = "#3D2E22";
      ctx.beginPath();
      ctx.roundRect(40, 645, canvas.width - 80, 75, 14);
      ctx.fill();

      ctx.fillStyle = "#D4AF37"; // Gold
      ctx.font = "bold 15px sans-serif";
      ctx.fillText("🔒 ZERO-KNOWLEDGE CRYPTOGRAPHIC GUARANTEE", 70, 678);

      ctx.fillStyle = "#F5EFE6";
      ctx.font = "13px sans-serif";
      ctx.fillText(
        "Funds are secured in autonomous Zcash escrow. Recipient can claim funds directly into any shielded Zcash wallet.",
        70,
        702
      );

      // 6. Trigger Download
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `veilx-receipt-${cleanHandle}-${Date.now().toString().slice(-6)}.png`;
      link.href = dataUrl;
      link.click();

      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      console.error("Receipt generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="p-4 bg-gradient-to-b from-butter-50 to-white rounded-2xl border border-butter-300 text-left space-y-3.5 shadow-subtle animate-in fade-in">
      {/* Receipt Header Badge */}
      <div className="flex items-center justify-between pb-2 border-b border-butter-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brown-900 text-white flex items-center justify-center">
            <Receipt className="w-4 h-4 text-butter-200" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-brown-500 tracking-wider block">
              Payment Receipt
            </span>
            <span className="text-xs font-mono font-bold text-brown-950">
              #{receiptId}
            </span>
          </div>
        </div>

        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100/80 border border-emerald-300 px-2 py-0.5 rounded-full">
          <ShieldCheck className="w-3 h-3 text-emerald-600" />
          Confirmed & Secured
        </span>
      </div>

      {/* Recipient & Amount Preview */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] text-brown-500 block">Recipient</span>
          <span className="text-sm font-bold text-brown-950">
            @{cleanHandle}
          </span>
        </div>
        <div className="text-right">
          <span className="text-[11px] text-brown-500 block">Amount</span>
          <span className="text-base font-mono font-extrabold text-brown-950 block">
            {amountZec} ZEC
          </span>
          {amountUsd && (
            <span className="text-[10px] text-emerald-700 font-bold block">
              ≈ {amountUsd} USD
            </span>
          )}
        </div>
      </div>

      {/* Proof / TxID Preview */}
      {txid && (
        <div className="p-2.5 bg-butter-50/70 rounded-xl border border-butter-200 font-mono text-[11px] text-brown-700 flex items-center justify-between gap-2">
          <span className="truncate">Tx: {truncateAddress(txid, 14, 10)}</span>
          <a
            href={getZcashExplorerUrl(txid)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brown-500 hover:text-brown-900 transition-colors shrink-0"
            title="Verify on Zcash Block Explorer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Download Action Button */}
      <Button
        type="button"
        onClick={handleDownload}
        variant="primary"
        className="w-full h-10 text-xs font-bold gap-2 shadow-subtle"
        isLoading={isGenerating}
      >
        {downloadSuccess ? (
          <>
            <Check className="w-4 h-4 text-emerald-300" />
            <span>Receipt Downloaded!</span>
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            <span>Download Invoice Receipt (PNG)</span>
          </>
        )}
      </Button>
    </div>
  );
}
