import React from "react";
import { Button } from "./Button";
import { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="py-12 px-4 flex flex-col items-center justify-center text-center max-w-sm mx-auto">
      {Icon && (
        <div className="w-12 h-12 rounded-2xl bg-butter-200/80 border border-butter-300 flex items-center justify-center text-brown-700 mb-3.5 shadow-subtle">
          <Icon className="w-6 h-6 text-brown-800" />
        </div>
      )}
      <h4 className="text-base font-bold text-brown-950">{title}</h4>
      <p className="mt-1 text-xs text-brown-500 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <div className="mt-5">
          <Button onClick={onAction} variant="outline" size="sm">
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
