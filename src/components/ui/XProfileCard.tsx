import React from "react";
import { Avatar } from "./Avatar";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface XProfileCardProps {
  name: string;
  username: string;
  profileImageUrl?: string | null;
  bio?: string | null;
  followersCount?: number;
  followingCount?: number;
  isVerified?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function XProfileCard({
  name,
  username,
  profileImageUrl,
  bio,
  followersCount,
  followingCount,
  isVerified = false,
  selected = false,
  onClick,
  className,
}: XProfileCardProps) {
  const cleanUsername = username.startsWith("@") ? username : `@${username}`;

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-4 bg-white border rounded-2xl transition-all duration-150 text-left shadow-subtle",
        selected
          ? "border-brown-900 bg-butter-50 ring-2 ring-brown-900/10"
          : "border-butter-300 hover:border-butter-400 hover:shadow-subtle",
        onClick && "cursor-pointer active:scale-[0.99]",
        className
      )}
    >
      <div className="flex items-start gap-3.5">
        <Avatar src={profileImageUrl} name={name || username} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h4 className="text-sm font-bold text-brown-950 truncate">{name}</h4>
            {isVerified && (
              <CheckCircle2 className="w-4 h-4 text-brown-800 shrink-0" />
            )}
          </div>
          <p className="text-xs font-medium text-brown-500 truncate">{cleanUsername}</p>

          {bio && (
            <p className="mt-1.5 text-xs text-brown-800 line-clamp-3 leading-relaxed font-normal">
              {bio}
            </p>
          )}

          {(typeof followingCount === "number" || typeof followersCount === "number") && (
            <div className="mt-2.5 flex items-center gap-3.5 text-[11px] font-medium text-brown-500">
              {typeof followingCount === "number" && (
                <span>
                  <strong className="text-brown-950 font-bold">
                    {new Intl.NumberFormat("en-US", { notation: "compact" }).format(followingCount)}
                  </strong>{" "}
                  Following
                </span>
              )}
              {typeof followersCount === "number" && (
                <span>
                  <strong className="text-brown-950 font-bold">
                    {new Intl.NumberFormat("en-US", { notation: "compact" }).format(followersCount)}
                  </strong>{" "}
                  Followers
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
