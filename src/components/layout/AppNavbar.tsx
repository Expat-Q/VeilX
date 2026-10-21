"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, LogOut, CheckCircle2, Inbox, XCircle, Link as LinkIcon } from "lucide-react";

export interface AppNavbarProps {
  user: {
    name?: string;
    username?: string;
    profileImageUrl?: string;
  };
  onLogout?: () => void;
}

export function AppNavbar({ user, onLogout }: AppNavbarProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [hasUnread, setHasUnread] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);

  const safeUsername = user?.username || "creator";
  const safeName = user?.name || safeUsername;
  const initial = (safeName || "C").charAt(0).toUpperCase();

  const network = (process.env.NEXT_PUBLIC_ZCASH_NETWORK || "mainnet").toLowerCase();
  const isMainnet = network === "mainnet";

  useEffect(() => {
    if (!safeUsername) return;

    const fetchNotifications = async () => {
      try {
        const notifs: any[] = [];
        const [tipsRes, reqsRes, paylinksRes] = await Promise.allSettled([
          fetch("/api/tips"),
          fetch("/api/requests"),
          fetch("/api/paylinks"),
        ]);

        // 1. Payment Requests (Incoming, Fulfilled, Declined, Cancelled)
        if (reqsRes.status === "fulfilled") {
          const reqsData = await reqsRes.value.json();
          if (reqsData.success && Array.isArray(reqsData.requests)) {
            reqsData.requests.forEach((r: any) => {
              const isTarget = (r.targetUsernameSnapshot || "").toLowerCase() === safeUsername.toLowerCase();
              const isRequester = (r.requesterUsernameSnapshot || "").toLowerCase() === safeUsername.toLowerCase();

              // A. Target received a new pending request
              if (isTarget && r.status === "PENDING") {
                notifs.push({
                  id: `req-pending-${r._id || r.id}`,
                  title: "Payment Request Received",
                  description: `@${r.requesterUsernameSnapshot || "Someone"} requested ${r.amountZec} ZEC from you.`,
                  time: "Pending",
                  status: "PENDING",
                  type: "request_incoming",
                  link: `/request/${r._id || r.id}`,
                });
              }

              // B. Requester: request was declined by target
              if (isRequester && r.status === "CANCELLED" && r.cancelledByRole === "target") {
                notifs.push({
                  id: `req-declined-${r._id || r.id}`,
                  title: "Request Declined",
                  description: `@${r.targetUsernameSnapshot || "User"} declined your request for ${r.amountZec} ZEC.`,
                  time: "Declined",
                  status: "DECLINED",
                  type: "request_declined",
                  link: `/request/${r._id || r.id}`,
                });
              }

              // C. Requester: request was paid/fulfilled by target
              if (isRequester && (r.status === "SETTLING" || r.status === "FORWARD_PENDING")) {
                notifs.push({
                  id: `req-settling-${r._id || r.id}`,
                  title: "Payment Confirming On-Chain",
                  description: `@${r.targetUsernameSnapshot || "User"} sent payment for your ${r.amountZec} ZEC request. Confirming in next block...`,
                  time: "Confirming",
                  status: r.status,
                  type: "request_settling",
                  link: `/request/${r._id || r.id}`,
                });
              }

              if (isTarget && (r.status === "SETTLING" || r.status === "FORWARD_PENDING")) {
                notifs.push({
                  id: `req-paying-${r._id || r.id}`,
                  title: "Payment Processing",
                  description: `Your payment to @${r.requesterUsernameSnapshot || "User"} has been broadcasted and is confirming on-chain.`,
                  time: "Confirming",
                  status: r.status,
                  type: "request_settling",
                  link: `/request/${r._id || r.id}`,
                });
              }

              if (isRequester && r.status === "FULFILLED") {
                notifs.push({
                  id: `req-paid-${r._id || r.id}`,
                  title: "Request Paid!",
                  description: `@${r.targetUsernameSnapshot || "User"} paid your request of ${r.amountZec} ZEC.`,
                  time: "Paid",
                  status: "FULFILLED",
                  type: "request_paid",
                  link: `/request/${r._id || r.id}`,
                });
              }

              // D. Target: requester cancelled their pending request
              if (isTarget && r.status === "CANCELLED" && r.cancelledByRole === "requester") {
                notifs.push({
                  id: `req-cancelled-${r._id || r.id}`,
                  title: "Request Cancelled",
                  description: `@${r.requesterUsernameSnapshot || "User"} cancelled their payment request.`,
                  time: "Cancelled",
                  status: "CANCELLED",
                  type: "request_cancelled",
                  link: `/request/${r._id || r.id}`,
                });
              }
            });
          }
        }

        // 2. Incoming Tips
        if (tipsRes.status === "fulfilled") {
          const data = await tipsRes.value.json();
          if (data.success && Array.isArray(data.tips)) {
            const incoming = data.tips.filter(
              (t: any) => (t.recipientUsernameSnapshot || "").toLowerCase() === safeUsername.toLowerCase()
            );
            incoming.slice(0, 3).forEach((t: any) => {
              notifs.push({
                id: `tip-${t._id || t.id}`,
                title: t.status === "FUNDED" ? "Shielded Tip Ready to Claim!" : t.status === "FUNDING_DETECTED" ? "Shielded Tip Incoming (Confirming)" : "Tip Received",
                description: `${t.isAnonymous ? "An anonymous supporter" : `@${t.senderUsernameSnapshot}`} sent ${t.amountZec} ZEC.`,
                time: t.status === "FUNDING_DETECTED" ? "Confirming" : "Recent",
                status: t.status,
                type: "tip",
              });
            });
          }
        }

        // 3. Paid PayLinks (for Creator)
        if (paylinksRes.status === "fulfilled") {
          const plData = await paylinksRes.value.json();
          if (plData.success && Array.isArray(plData.paylinks)) {
            const paidLinks = plData.paylinks.filter((pl: any) => pl.status === "PAID" || pl.status === "FORWARD_PENDING" || pl.status === "SETTLING");
            paidLinks.slice(0, 3).forEach((pl: any) => {
              notifs.push({
                id: `pl-${pl._id || pl.id}`,
                title: pl.status === "PAID" ? "PayLink Paid!" : "PayLink Payment Confirming",
                description: `"${pl.title}" was settled for ${pl.amountZec} ZEC.`,
                time: pl.status === "PAID" ? "Settled" : "Confirming",
                status: "PAID",
                type: "paylink",
                link: `/pay/${pl.slug}`,
              });
            });
          }
        }

        // 4. Referral reward notification
        notifs.push({
          id: "notif-ref",
          title: "Referral Rewards Active",
          description: "Earn 0.01 ZEC & 100 points for every creator who signs up with your link.",
          time: "Live",
          status: "INFO",
          type: "info",
        });

        setNotifications(notifs);
      } catch (err) {
        console.warn("Failed to fetch notifications:", err);
      }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, [safeUsername]);

  return (
    <header className="sticky top-0 z-40 w-full bg-butter-100/95 backdrop-blur-md border-b border-butter-300 text-brown-950 shadow-subtle">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        {/* Left: VeilX Brand Logo & Network Indicator */}
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2 shrink-0 group">
            <img
              src="/VeilX_logo.png"
              alt="VeilX Logo"
              className="h-8 w-8 object-contain rounded-xl shadow-subtle group-hover:scale-105 transition-all bg-white p-0.5 border border-butter-300"
            />
            <span className="font-extrabold text-lg text-brown-950 tracking-tight">
              VeilX
            </span>
          </Link>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border tracking-wide uppercase ${
            isMainnet
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-amber-50 text-amber-800 border-amber-200"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isMainnet ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
            {isMainnet ? "Mainnet" : "Testnet"}
          </span>
        </div>

        {/* Right: User Profile, Notification Bell & Direct Sign Out */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-2 pl-2 border-l border-butter-300">
            {user?.profileImageUrl ? (
              <img
                src={user.profileImageUrl}
                alt={safeName}
                className="w-8 h-8 rounded-full border border-butter-300 object-cover shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-brown-900 text-butter-100 flex items-center justify-center font-bold text-xs shrink-0 shadow-subtle">
                {initial}
              </div>
            )}
            <span className="text-xs font-bold text-brown-900 hidden sm:inline truncate max-w-[120px]">
              @{safeUsername}
            </span>
          </div>

          {/* Notifications button */}
          <div className="relative flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                setShowNotifications(!showNotifications);
                setHasUnread(false);
              }}
              className="relative p-2 rounded-xl bg-white hover:bg-butter-50 text-brown-900 transition-all border border-butter-300 active:scale-95 shadow-subtle"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell className="w-4 h-4 text-brown-900" />
              {hasUnread && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white animate-pulse" />
              )}
            </button>

            {/* Direct Logout Button */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="p-2 rounded-xl bg-white hover:bg-rose-50 text-brown-700 hover:text-rose-700 transition-all border border-butter-300 active:scale-95 shadow-subtle"
                title="Sign out of VeilX"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}

            {/* Notifications Dropdown Popover */}
            {showNotifications && (
              <div className="absolute right-0 top-12 w-72 sm:w-80 bg-white border border-butter-300 rounded-2xl shadow-elevated p-3 z-50 text-brown-900 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-butter-200">
                  <span className="text-xs font-bold text-brown-950 uppercase tracking-wider">
                    Notifications
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    {notifications.length} alerts
                  </span>
                </div>
                
                <div className="space-y-2 text-left max-h-64 overflow-y-auto">
                  {notifications.map((n) => {
                    const content = (
                      <>
                        <div className="flex items-center justify-between font-bold text-brown-900 mb-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {n.type === "request_declined" || n.type === "request_cancelled" ? (
                              <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                            ) : n.type === "request_incoming" ? (
                              <Inbox className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            ) : n.type === "paylink" ? (
                              <LinkIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            )}
                            <span className="truncate">{n.title}</span>
                          </div>
                          <span className="text-[10px] text-brown-500 font-normal shrink-0 ml-1.5">{n.time}</span>
                        </div>
                        <p className="text-[11px] text-brown-600 leading-snug">
                          {n.description}
                        </p>
                      </>
                    );

                    if (n.link) {
                      const linkBg =
                        n.type === "request_declined" || n.type === "request_cancelled"
                          ? "bg-rose-50/70 hover:bg-rose-100/80 border-rose-200"
                          : n.type === "paylink" || n.type === "request_paid"
                          ? "bg-emerald-50/70 hover:bg-emerald-100/80 border-emerald-200"
                          : "bg-amber-50/70 hover:bg-amber-100/80 border-amber-200";

                      return (
                        <Link
                          key={n.id}
                          href={n.link}
                          onClick={() => setShowNotifications(false)}
                          className={`block p-2.5 rounded-xl border text-xs transition-colors cursor-pointer ${linkBg}`}
                        >
                          {content}
                        </Link>
                      );
                    }

                    return (
                      <div key={n.id} className="p-2.5 rounded-xl bg-butter-50 border border-butter-200 text-xs">
                        {content}
                      </div>
                    );
                  })}
                </div>

                {onLogout && (
                  <div className="mt-3 pt-2 border-t border-butter-200">
                    <button
                      onClick={() => {
                        setShowNotifications(false);
                        onLogout();
                      }}
                      className="w-full py-2 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign out</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
