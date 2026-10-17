"use client";

import React, { useState } from "react";
import { Shield, ArrowRight, Lock, CheckCircle2, Zap } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { XLogo } from "@/components/ui/XLogo";

export interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (user: any) => void;
}

export function LoginModal({ isOpen, onClose, onSuccess }: LoginModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleTwitterLogin = () => {
    setIsLoading(true);
    // Initiates Twitter OAuth 2.0 PKCE redirect
    window.location.href = "/api/auth/twitter";
  };


  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="sm">
      <div className="py-2 text-center space-y-6">
        {/* Brand Logo */}
        <div className="w-16 h-16 rounded-2xl bg-butter-50 border border-butter-300 flex items-center justify-center mx-auto shadow-elevated p-1.5">
          <img
            src="/VeilX_logo.png"
            alt="VeilX Logo"
            className="w-full h-full object-contain rounded-xl"
          />
        </div>

        {/* Headline & Subtitle */}
        <div className="space-y-1.5">
          <h3 className="text-xl font-extrabold text-brown-950 tracking-tight">
            Private payments, in one place.
          </h3>
          <p className="text-xs text-brown-500 max-w-xs mx-auto leading-relaxed">
            Send, receive, and claim shielded Zcash tips directly with your X identity.
          </p>
        </div>

        {/* Primary Action Button (Sign in with Official X Logo) */}
        <div className="space-y-2.5 pt-2">
          <Button
            onClick={handleTwitterLogin}
            variant="primary"
            className="w-full h-12 text-sm font-semibold gap-2.5 shadow-subtle justify-center"
            isLoading={isLoading}
          >
            <XLogo className="w-4 h-4 fill-white text-white shrink-0" />
            <span>Continue with X</span>
            <ArrowRight className="w-4 h-4 ml-auto text-brown-300" />
          </Button>


        </div>

        {/* Footer Note */}
        <div className="text-[11px] text-brown-400 pt-2 flex items-center justify-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-emerald-600" />
          <span>No custody of your private keys</span>
        </div>
      </div>
    </Modal>
  );
}
