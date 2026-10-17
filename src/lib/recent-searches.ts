/**
 * Client-side Storage for Recently Searched 𝕏 Accounts
 * Persists up to 8 unique accounts in localStorage for quick-select tipping and requests.
 */

export interface SearchedAccount {
  name: string;
  username: string;
  bio?: string;
  followersCount?: number;
  followingCount?: number;
  profileImageUrl?: string;
  isVerified?: boolean;
  xUserId?: string;
  searchedAt?: number;
}

const STORAGE_KEY = "veilx_recent_accounts";
const MAX_RECENT_ACCOUNTS = 8;

export function getRecentAccounts(): SearchedAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentAccount(account: SearchedAccount): SearchedAccount[] {
  if (typeof window === "undefined" || !account || !account.username) {
    return [];
  }

  try {
    const existing = getRecentAccounts();
    const cleanUsername = account.username.replace("@", "").toLowerCase();

    // Remove if already present (to move it to top)
    const filtered = existing.filter(
      (a) => a.username.replace("@", "").toLowerCase() !== cleanUsername
    );

    const updated: SearchedAccount[] = [
      {
        ...account,
        username: account.username.replace("@", ""),
        searchedAt: Date.now(),
      },
      ...filtered,
    ].slice(0, MAX_RECENT_ACCOUNTS);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function clearRecentAccounts(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore error
  }
}
