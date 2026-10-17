"use client";

import React from "react";
import { Home, Send, Inbox, Link2, User } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MobileNavProps {
  activeTab: "home" | "tips" | "requests" | "links" | "profile";
  onSelectTab: (tab: "home" | "tips" | "requests" | "links" | "profile") => void;
  onOpenTip?: () => void;
}

export function MobileNav({ activeTab, onSelectTab, onOpenTip }: MobileNavProps) {
  const tabs = [
    { id: "home" as const, label: "Home", icon: Home },
    { id: "tips" as const, label: "Tips", icon: Send },
    { id: "requests" as const, label: "Requests", icon: Inbox },
    { id: "links" as const, label: "PayLinks", icon: Link2 },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-butter-100/95 backdrop-blur-xl border-t border-butter-300 px-4 pt-2 pb-5 sm:pb-3 shadow-modal">
      <div className="flex items-center justify-around max-w-md mx-auto">
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onSelectTab(id)}
              className={cn(
                "flex flex-col items-center justify-center py-1.5 px-3.5 rounded-2xl transition-all duration-150 active:scale-95 touch-manipulation",
                isActive
                  ? "bg-brown-900 text-white shadow-subtle font-bold"
                  : "text-brown-600 hover:text-brown-950 hover:bg-butter-200/50 font-medium"
              )}
            >
              <Icon className={cn("w-4 h-4", isActive ? "text-white stroke-[2.5]" : "text-brown-500")} />
              <span className="text-[10px] mt-0.5 tracking-tight">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
