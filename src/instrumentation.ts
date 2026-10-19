/**
 * Next.js Server Lifecycle Instrumentation
 * On persistent hosts like Render, this runs once when the server boots.
 * It establishes the background reconciliation loop to auto-sweep and forward payouts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Only activate auto-sweeping in production / persistent server environments
    const isPersistentHost = process.env.RENDER === "true" || process.env.PERSISTENT_WORKER === "true";
    
    if (isPersistentHost) {
      console.log("[VeilX Daemon] Persistent background sweeper activated.");
      const { dbService } = await import("@/lib/db-service");

      // Auto-sweep pending payouts every 15 seconds
      setInterval(async () => {
        try {
          await dbService.reconcilePendingForwards();
        } catch (e: any) {
          // Ignore transient network blips
        }
      }, 15000);
    }
  }
}
