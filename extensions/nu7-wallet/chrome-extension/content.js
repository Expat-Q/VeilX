/**
 * VeilX NU7 Wallet — Content Script Bridge
 */
(function () {
  try {
    const container = document.head || document.documentElement;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inpage.js");
    script.async = false;
    container.insertBefore(script, container.children[0]);
    script.onload = () => script.remove();
  } catch (e) {
    console.error("[VeilX NU7 Extension] Failed to inject inpage provider:", e);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.target !== "VEILX_NU7_CONTENT") {
      return;
    }
    const { id, method, params } = event.data;

    chrome.runtime.sendMessage({ type: "VEILX_RPC", id, method, params }, (response) => {
      const lastErr = chrome.runtime.lastError;
      window.postMessage(
        {
          target: "VEILX_NU7_INPAGE",
          id,
          result: response?.result,
          error: lastErr ? lastErr.message : response?.error,
        },
        "*"
      );
    });
  });
})();
