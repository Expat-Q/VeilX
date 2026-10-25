/**
 * Next.js Server Lifecycle Instrumentation
 * On persistent hosts like Render, this runs once when the server boots.
 * It establishes the background reconciliation loop to auto-sweep and forward payouts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[VeilX] Server initialized in request-driven mode (Render Free Plan compatible).");
  }
}
