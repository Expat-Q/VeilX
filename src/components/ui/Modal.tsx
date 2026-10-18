"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl";
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  className,
  maxWidth = "md",
}: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-brown-950/60 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div
        className={cn(
          "relative w-full bg-white border border-butter-300 rounded-[28px] sm:rounded-[32px] shadow-modal p-5 sm:p-7 z-10 text-left transform transition-all duration-300 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto my-auto",
          maxWidthClasses[maxWidth],
          className
        )}
      >

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            {title && <h3 className="text-lg font-bold text-brown-950">{title}</h3>}
            {subtitle && <p className="text-xs font-medium text-brown-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-brown-400 hover:text-brown-800 hover:bg-butter-100 transition-all focus:outline-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div>{children}</div>
      </div>
    </div>
  );
}
