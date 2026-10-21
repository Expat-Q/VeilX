"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Inbox,
  ArrowRight,
  Sparkles,
  UserCheck,
  Search,
  Copy,
  Check,
  ExternalLink,
  Wallet,
  Loader2,
  AlertCircle,
  X,
  CheckCircle2,
  Clock,
  Clipboard,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AmountInput } from "@/components/ui/AmountInput";
import { XProfileCard } from "@/components/ui/XProfileCard";
import { XLogo } from "@/components/ui/XLogo";
import { connectBrowserWallet, isMobileDevice } from "@/lib/wallet";
import { validateZcashAddressFull } from "@/lib/zcash-address";
import { NetworkMismatchAlert } from "@/components/ui/NetworkMismatchAlert";
import { useZecPrice } from "@/lib/price-service";
import {
  getRecentAccounts,
  saveRecentAccount,
  clearRecentAccounts,
  SearchedAccount,
} from "@/lib/recent-searches";

export interface RequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUser?: {
    name: string;
    username: string;
    profileImageUrl?: string;
  } | null;
}

export function RequestModal({ isOpen, onClose, initialUser }: RequestModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [usernameSearch, setUsernameSearch] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any | null>(initialUser || null);
  const [liveSuggestions, setLiveSuggestions] = useState<any[]>([]);
  const [recentAccounts, setRecentAccounts] = useState<SearchedAccount[]>([]);

  useEffect(() => {
    if (isOpen) {
      setRecentAccounts(getRecentAccounts());
    }
  }, [isOpen]);

  // Form Fields
  const [amountZec, setAmountZec] = useState("0.5");
  const [reason, setReason] = useState("");
  const [shieldedUa, setShieldedUa] = useState("");
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  const { formatZecToUsd } = useZecPrice();
  const addressValidation = shieldedUa.trim() ? validateZcashAddressFull(shieldedUa.trim(), "mainnet") : null;

  // Result state
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle typing and deleting in real-time
  const handleInputChange = (value: string) => {
    setUsernameSearch(value);
    setErrorNotice(null);

    // If a profile was selected, immediately clear it when the user types or deletes text
    if (selectedUser) {
      setSelectedUser(null);
    }

    const clean = value.replace("@", "").trim().toLowerCase();

    // If input is emptied, clear live suggestions
    if (!clean) {
      setLiveSuggestions([]);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      return;
    }

    // 1. Instant local filter from recently searched accounts
    const localMatches = recentAccounts.filter(
      (acc) =>
        acc.username.toLowerCase().includes(clean) ||
        acc.name.toLowerCase().includes(clean)
    );
    setLiveSuggestions(localMatches);

    // 2. Debounce live auto-lookup against X lookup API
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/users/lookup?username=${clean}`);
        const data = await res.json();
        const user = data.profile || data.user;
        if (data.success && user) {
          const apiUser = {
            name: user.name || clean,
            username: user.username || clean,
            bio: user.bio || undefined,
            followersCount: typeof user.followersCount === "number" ? user.followersCount : undefined,
            followingCount: typeof user.followingCount === "number" ? user.followingCount : undefined,
            profileImageUrl: user.profileImageUrl || `https://unavatar.io/x/${clean}`,
            isVerified: user.isVerified ?? false,
            xUserId: user.xUserId || `x_${clean}_${Date.now()}`,
          };
          // Append to suggestions if not duplicate
          setLiveSuggestions((prev) => {
            const exists = prev.some((p) => p.username.toLowerCase() === apiUser.username.toLowerCase());
            return exists ? prev : [apiUser, ...prev];
          });
        }
      } catch (err) {
        // Silent fail for debounced lookup
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  const handleSearch = async (handleToSearch?: string) => {
    const raw = handleToSearch || usernameSearch;
    if (!raw.trim()) return;
    setIsSearching(true);
    setErrorNotice(null);
    const clean = raw.replace("@", "").trim();

    try {
      const res = await fetch(`/api/users/lookup?username=${clean}`);
      const data = await res.json();
      const user = data.profile || data.user;
      if (data.success && user) {
        const found = {
          name: user.name || clean,
          username: user.username || clean,
          bio: user.bio || undefined,
          followersCount: typeof user.followersCount === "number" ? user.followersCount : undefined,
          followingCount: typeof user.followingCount === "number" ? user.followingCount : undefined,
          profileImageUrl: user.profileImageUrl || `https://unavatar.io/x/${clean}`,
          isVerified: user.isVerified ?? false,
          xUserId: user.xUserId || `x_${clean}_${Date.now()}`,
        };
        setSelectedUser(found);
        const updated = saveRecentAccount(found);
        setRecentAccounts(updated);
      } else {
        const fallback = {
          name: clean.charAt(0).toUpperCase() + clean.slice(1),
          username: clean,
          bio: undefined,
          followersCount: undefined,
          profileImageUrl: `https://unavatar.io/x/${clean}`,
          isVerified: false,
          xUserId: `x_${clean}_${Date.now()}`,
        };
        setSelectedUser(fallback);
        const updated = saveRecentAccount(fallback);
        setRecentAccounts(updated);
      }
    } catch (e) {
      const fallback = {
        name: clean.charAt(0).toUpperCase() + clean.slice(1),
        username: clean,
        bio: undefined,
        followersCount: undefined,
        profileImageUrl: `https://unavatar.io/x/${clean}`,
        isVerified: false,
        xUserId: `x_${clean}_${Date.now()}`,
      };
      setSelectedUser(fallback);
      const updated = saveRecentAccount(fallback);
      setRecentAccounts(updated);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectAccount = (account: any) => {
    setSelectedUser(account);
    setUsernameSearch(account.username);
    setLiveSuggestions([]);
    const updated = saveRecentAccount(account);
    setRecentAccounts(updated);
  };

  const handleClearSearch = () => {
    setUsernameSearch("");
    setSelectedUser(null);
    setLiveSuggestions([]);
    setErrorNotice(null);
  };

  const handleAutoFillWallet = async () => {
    setErrorNotice(null);

    // Mobile UX: 1-tap paste from clipboard rather than failing extension injection
    if (isMobile) {
      try {
        if (!navigator.clipboard?.readText) {
          setErrorNotice("Clipboard access unavailable. Please paste your address manually.");
          return;
        }
        const text = await navigator.clipboard.readText();
        const cleaned = text.trim();
        if (!cleaned) {
          setErrorNotice("Clipboard is empty. Copy your address from your wallet (Zashi, YWallet) first.");
          return;
        }
        setShieldedUa(cleaned);
      } catch (err: any) {
        setErrorNotice("Clipboard permission denied. Please paste your address into the field.");
      }
      return;
    }

    setIsAutoFilling(true);
    try {
      const res = await connectBrowserWallet();
      if (res.address && res.address !== "shielded_connected") {
        setShieldedUa(res.address);
      } else {
        setErrorNotice("Zcash browser wallet not detected or locked. Please paste your address manually.");
      }
    } catch (err: any) {
      setErrorNotice(err.message || "Zcash browser wallet not detected. Please paste your address manually.");
    } finally {
      setIsAutoFilling(false);
    }
  };

  const handleCreateRequest = async () => {
    if (!selectedUser || !amountZec || !shieldedUa.trim()) return;
    setIsLoading(true);
    setErrorNotice(null);

    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetXUserId: selectedUser.xUserId,
          targetUsername: selectedUser.username,
          amountZec,
          memo: reason,
          recipientShieldedUa: shieldedUa.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.request) {
        const reqId = data.request._id || data.request.id;
        setCreatedLink(`${window.location.origin}/request/${reqId}`);
        setStep(3);
      } else {
        setErrorNotice(data.error || "Failed to create payment request.");
      }
    } catch (e: any) {
      setErrorNotice(e.message || "Network error. Failed to reach request service.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setStep(1);
    setUsernameSearch("");
    setSelectedUser(null);
    setLiveSuggestions([]);
    setAmountZec("0.5");
    setReason("");
    setShieldedUa("");
    setCreatedLink(null);
    setErrorNotice(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title={
        step === 1
          ? "Request Zcash Payment"
          : step === 2
          ? `Request from @${selectedUser?.username}`
          : "Request Link Ready!"
      }
      subtitle={
        step === 1
          ? "Search by 𝕏 handle to specify who should settle this request"
          : step === 2
          ? "Set amount, note, and your transparent settlement address (t1...)"
          : "Share this link with them to settle non-custodially"
      }
    >
      {/* STEP 1: Search Target Recipient */}
      {step === 1 && (
        <div className="space-y-4 text-left">
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                value={usernameSearch}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Type 𝕏 handle (e.g. zooko)..."
                leftIcon={<Search className="w-4 h-4 text-brown-400" />}
                rightElement={
                  usernameSearch ? (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      className="p-1 hover:bg-butter-100 rounded-full text-brown-400 hover:text-brown-700 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null
                }
              />
            </div>
            <Button onClick={() => handleSearch()} variant="primary" size="md" isLoading={isSearching}>
              Search
            </Button>
          </div>

          {selectedUser ? (
            <div className="space-y-3 pt-1 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-brown-500 uppercase tracking-wider">
                  Target Account Preview
                </p>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <UserCheck className="w-3 h-3 text-emerald-600" />
                  Account Verified
                </span>
              </div>
              <XProfileCard
                name={selectedUser.name}
                username={selectedUser.username}
                profileImageUrl={selectedUser.profileImageUrl}
                bio={selectedUser.bio}
                followersCount={selectedUser.followersCount}
                followingCount={selectedUser.followingCount}
                isVerified={selectedUser.isVerified}
                selected={true}
              />
              <Button
                onClick={() => setStep(2)}
                variant="primary"
                className="w-full gap-2 mt-4 h-12 font-bold shadow-elevated active:scale-95"
              >
                <span>Continue to Request Details</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          ) : usernameSearch.trim() ? (
            /* Live Suggestions List while typing */
            <div className="space-y-2 pt-1 animate-in fade-in">
              <div className="flex items-center justify-between text-xs text-brown-500 font-semibold">
                <span>Matching Suggestions</span>
                {isSearching && (
                  <span className="flex items-center gap-1 text-brown-400">
                    <Loader2 className="w-3 h-3 animate-spin" /> Searching 𝕏...
                  </span>
                )}
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {/* 1. Direct Search Option */}
                <button
                  type="button"
                  onClick={() => handleSearch(usernameSearch)}
                  className="w-full p-3 rounded-2xl bg-butter-50 hover:bg-butter-100 border border-butter-200 hover:border-butter-300 text-left transition-all flex items-center justify-between group shadow-subtle"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-brown-900 text-white flex items-center justify-center font-bold text-xs shadow-subtle">
                      @
                    </div>
                    <div>
                      <p className="text-xs font-bold text-brown-950">Request from @{usernameSearch.replace("@", "")}</p>
                      <p className="text-[11px] text-brown-500">Tap to select this handle</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-brown-400 group-hover:text-brown-900 group-hover:translate-x-0.5 transition-all" />
                </button>

                {/* 2. Matched suggestions */}
                {liveSuggestions.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => handleSelectAccount(acc)}
                    className="w-full p-3 rounded-2xl bg-white hover:bg-butter-50 border border-butter-200 hover:border-butter-300 text-left transition-all flex items-center justify-between group shadow-subtle"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={acc.profileImageUrl || `https://unavatar.io/x/${acc.username}`}
                        alt={acc.name}
                        className="w-9 h-9 rounded-full border border-butter-300 object-cover shrink-0"
                        onError={(e) => {
                          e.currentTarget.src = `https://unavatar.io/x/${acc.username}`;
                        }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-bold text-brown-950 truncate group-hover:text-brown-800">
                            {acc.name}
                          </p>
                          {acc.isVerified && <CheckCircle2 className="w-3 h-3 text-brown-700 shrink-0" />}
                        </div>
                        <p className="text-[11px] text-brown-500 truncate">@{acc.username}</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-brown-700 bg-butter-100 group-hover:bg-brown-900 group-hover:text-white px-2.5 py-1 rounded-full transition-all shrink-0">
                      Select
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : recentAccounts.length > 0 ? (
            /* Recent accounts when search is blank */
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-brown-600">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-brown-600" />
                  <span>Recently Searched Accounts</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearRecentAccounts();
                    setRecentAccounts([]);
                  }}
                  className="text-[11px] text-brown-400 hover:text-brown-700 underline font-normal transition-colors"
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                {recentAccounts.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => handleSelectAccount(acc)}
                    className="p-2.5 rounded-2xl bg-butter-50 hover:bg-butter-100 border border-butter-300 hover:border-butter-400 text-left transition-all flex items-center justify-between gap-2 group shadow-subtle active:scale-95"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={acc.profileImageUrl || `https://unavatar.io/x/${acc.username}`}
                        alt={acc.name}
                        className="w-8 h-8 rounded-full border border-butter-300 object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-bold text-brown-950 truncate group-hover:text-brown-700">
                            {acc.name}
                          </p>
                          {acc.isVerified && <CheckCircle2 className="w-3 h-3 text-brown-700 shrink-0" />}
                        </div>
                        <p className="text-[11px] text-brown-500 truncate">@{acc.username}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-brown-600 bg-butter-100 group-hover:bg-brown-900 group-hover:text-white px-2 py-0.5 rounded-full transition-all shrink-0">
                      Select
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Clean empty state prompt */
            <div className="text-center py-6 px-4 bg-butter-50/60 rounded-2xl border border-dashed border-butter-300 my-2">
              <div className="w-10 h-10 rounded-full bg-butter-100 flex items-center justify-center mx-auto mb-2 text-brown-600">
                <Search className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-brown-950">Request ZEC from Any 𝕏 User</p>
              <p className="text-[11px] text-brown-500 max-w-xs mx-auto mt-0.5">
                Type any 𝕏 handle above to create a private payment request link.
              </p>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Amount, Note & Transparent Settlement Address */}
      {step === 2 && selectedUser && (
        <div className="space-y-4 text-left">
          {errorNotice && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorNotice}</span>
            </div>
          )}

          {/* Target Mini Bar */}
          <div className="p-3 bg-butter-50 border border-butter-200 rounded-2xl flex items-center justify-between shadow-subtle">
            <div className="flex items-center gap-2.5">
              <img
                src={selectedUser.profileImageUrl}
                alt={selectedUser.name}
                className="w-8 h-8 rounded-full object-cover border border-butter-300"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <div>
                <p className="text-xs font-bold text-brown-950">Requesting from {selectedUser.name}</p>
                <p className="text-[11px] text-brown-500">@{selectedUser.username}</p>
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedUser(null);
                setErrorNotice(null);
                setStep(1);
              }}
              className="text-xs font-semibold text-brown-700 hover:text-brown-950 underline"
            >
              Change
            </button>
          </div>

          <AmountInput
            value={amountZec}
            onChange={(v) => {
              setAmountZec(v);
              setErrorNotice(null);
            }}
            label="Requested Amount"
          />

          <Input
            label="Reason / Note (Optional)"
            placeholder="e.g. Invoice for frontend design commission"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErrorNotice(null);
            }}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-brown-900">
                Your Transparent Settlement Address (t1...)
              </label>
              <button
                type="button"
                onClick={handleAutoFillWallet}
                disabled={isAutoFilling}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brown-900 hover:bg-brown-950 text-white rounded-lg text-xs font-bold shadow-subtle transition-all active:scale-95 disabled:opacity-60"
              >
                {isMobile ? (
                  <>
                    <Clipboard className="w-3.5 h-3.5 text-butter-200" />
                    <span>Paste Address</span>
                  </>
                ) : isAutoFilling ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Detecting Wallet...</span>
                  </>
                ) : (
                  <>
                    <Wallet className="w-3.5 h-3.5 text-butter-200" />
                    <span>Auto-Fill Wallet</span>
                  </>
                )}
              </button>
            </div>

            <Input
              placeholder="t1... (Your wallet&apos;s transparent address for auto-forwarding)"
              value={shieldedUa}
              onChange={(e) => {
                setShieldedUa(e.target.value);
                setErrorNotice(null);
              }}
              className={`font-mono text-xs ${
                addressValidation
                  ? addressValidation.isValid
                    ? "border-emerald-400 focus:ring-emerald-400"
                    : "border-rose-300 focus:ring-rose-300"
                  : ""
              }`}
            />
            {addressValidation?.isNetworkMismatch ? (
              <NetworkMismatchAlert isNetworkMismatch={true} />
            ) : addressValidation?.isValid ? (
              <div className="space-y-1.5">
                {(addressValidation.type === "p2pkh" || addressValidation.type === "p2sh") ? (
                  <p className="text-[11px] text-emerald-700 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Valid Mainnet Transparent address (⚡ Instant Auto-Forwarding)</span>
                  </p>
                ) : (
                  <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2 text-xs text-amber-950 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-bold">Shielded Address Detected</span>
                      <p className="text-[11px] text-amber-800 leading-snug">
                        Auto-forwarding requires a transparent address (<code className="font-mono font-bold text-amber-950">t1...</code>) for instant settlement without cloud proving delays. You can easily re-shield in your wallet anytime.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : addressValidation && !addressValidation.isValid && shieldedUa.trim().length >= 10 ? (
              <p className="text-[11px] text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>{addressValidation.error || "Please enter a valid Zcash address starting with 'u' or 't'"}</span>
              </p>
            ) : (
              <p className="text-[11px] text-brown-500">
                Paste your wallet&apos;s transparent address (starts with t1...) for instant auto-forwarding.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={() => setStep(1)} variant="outline" className="w-1/3 font-bold">
              Back
            </Button>
            <Button
              onClick={handleCreateRequest}
              variant="primary"
              className="w-2/3 gap-2 font-bold"
              disabled={
                !amountZec ||
                parseFloat(amountZec) <= 0 ||
                !shieldedUa.trim() ||
                isLoading ||
                Boolean(addressValidation && !addressValidation.isValid) ||
                Boolean(addressValidation?.isNetworkMismatch) ||
                Boolean(addressValidation && addressValidation.type !== "p2pkh" && addressValidation.type !== "p2sh")
              }
              isLoading={isLoading}
            >
              <span>Create Request Link</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Link Created & Ready to Share */}
      {step === 3 && selectedUser && createdLink && (
        <div className="space-y-4 text-center py-3 animate-in fade-in zoom-in-95">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200 mx-auto flex items-center justify-center shadow-subtle">
            <Inbox className="w-6 h-6" />
          </div>

          <div>
            <h4 className="text-base font-bold text-brown-950">
              Payment Request Created!
            </h4>
            <p className="text-xs text-brown-500 mt-0.5">
              Requested <strong>{amountZec} ZEC</strong>{" "}
              <span className="font-mono text-brown-500">
                (≈ {formatZecToUsd(amountZec)} USD)
              </span>{" "}
              from <strong>@{selectedUser.username}</strong>
            </p>
          </div>

          {/* Copy Link Card */}
          <div className="p-3 bg-butter-50 rounded-2xl border border-butter-200 flex items-center justify-between gap-2 shadow-subtle text-left">
            <p className="text-xs font-mono text-brown-800 truncate select-all">{createdLink}</p>
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-white border border-butter-300 text-brown-700 hover:bg-butter-100 transition-all shrink-0 font-bold"
              title="Copy link"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          {/* 1-Click Tweet Intent */}
          <a
            href={`https://x.com/intent/tweet?text=${encodeURIComponent(
              `Hey @${selectedUser.username}, I've created a privacy-shielded payment request for ${amountZec} ZEC on @VeilXApp:\n\n${createdLink}`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-11 inline-flex items-center justify-center gap-2 bg-brown-900 hover:bg-brown-950 text-white font-bold text-xs rounded-xl shadow-elevated transition-all active:scale-95"
          >
            <XLogo className="w-3.5 h-3.5 fill-current text-white shrink-0" />
            <span>Tweet Request to @{selectedUser.username}</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-70 ml-1" />
          </a>

          <Button onClick={handleReset} variant="outline" className="w-full font-bold">
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
