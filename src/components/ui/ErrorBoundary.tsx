"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw, LogOut } from "lucide-react";
import { Button } from "./Button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 max-w-lg mx-auto my-10 bg-white border border-rose-300 rounded-3xl shadow-modal text-left space-y-4 animate-in fade-in">
          <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{this.props.fallbackTitle || "Error Rendering Dashboard Component"}</span>
          </div>
          <div className="p-3 bg-rose-50 rounded-2xl border border-rose-200">
            <p className="text-xs font-mono text-rose-900 break-words leading-relaxed">
              {this.state.error?.message || "Unknown error"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              variant="primary"
              size="sm"
              className="gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Render</span>
            </Button>
            <Button
              onClick={async () => {
                try {
                  await fetch("/api/auth/logout", { method: "POST" });
                } catch (e) {}
                window.location.reload();
              }}
              variant="outline"
              size="sm"
              className="gap-1.5 text-rose-700 hover:bg-rose-50 border-rose-200"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Reset & Sign Out</span>
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
