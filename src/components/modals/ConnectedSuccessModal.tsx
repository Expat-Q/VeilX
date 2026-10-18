"use client";

import React from "react";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export interface ConnectedSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: {
    name?: string;
    username?: string;
    profileImageUrl?: string;
  } | null;
}

export function ConnectedSuccessModal({
  isOpen,
  onClose,
  user,
}: ConnectedSuccessModalProps) {
  const displayName = user?.name || user?.username || "Creator";
  const username = user?.username || "creator";

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="sm">
      <div className="py-2 text-center space-y-5">
        {/* Success Icon */}
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-subtle animate-in zoom-in-95">
          <CheckCircle2 className="w-8 h-8" />
        </div>

        {/* Title & Subtitle */}
        <div className="space-y-1.5">
          <h3 className="text-xl font-extrabold text-brown-950 tracking-tight">
            Account Connected!
          </h3>
          <p className="text-xs text-brown-500 max-w-xs mx-auto leading-relaxed">
            Welcome to VeilX! Your 𝕏 account is successfully linked to private, shielded payments.
          </p>
        </div>

        {/* User Identity Snapshot */}
        <div className="p-3.5 bg-butter-50 border border-butter-200 rounded-2xl flex items-center gap-3 text-left shadow-subtle">
          {user?.profileImageUrl ? (
            <img
              src={user.profileImageUrl}
              alt={displayName}
              className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-subtle shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="w-11 h-11 rounded-full bg-brown-900 text-white flex items-center justify-center font-bold text-sm shrink-0">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-brown-950 truncate">{displayName}</p>
              <span className="inline-flex items-center text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full">
                Active
              </span>
            </div>
            <p className="text-xs text-brown-500 font-mono truncate">@{username}</p>
          </div>
        </div>

        {/* Single Continue Action */}
        <div className="pt-2">
          <Button
            onClick={onClose}
            variant="primary"
            className="w-full h-12 text-sm font-bold gap-2 justify-center shadow-elevated"
          >
            <span>Continue to Dashboard</span>
            <ArrowRight className="w-4 h-4 text-butter-200" />
          </Button>
        </div>
      </div>
    </Modal>
  );
}
