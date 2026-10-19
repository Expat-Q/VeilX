/**
 * VeilX Security Authorization Modal Logic
 */
(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const reqId = urlParams.get("id");

  const netLabel = document.getElementById("netLabel");
  const reqOrigin = document.getElementById("reqOrigin");
  const reqBadge = document.getElementById("reqBadge");
  const dynamicDetails = document.getElementById("dynamicDetails");
  const secNotice = document.getElementById("secNotice");
  const btnReject = document.getElementById("btnReject");
  const btnApprove = document.getElementById("btnApprove");

  function escapeHtml(str) {
    if (typeof str !== "string") str = String(str || "");
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  if (!reqId) {
    dynamicDetails.innerHTML = "<div style='color:#ef4444; padding:12px;'>Invalid request: missing authorization request ID.</div>";
    btnApprove.disabled = true;
    return;
  }

  chrome.runtime.sendMessage({ type: "VEILX_GET_APPROVAL_REQUEST", id: reqId }, (res) => {
    if (!res || !res.request) {
      dynamicDetails.innerHTML = "<div style='color:#ef4444; padding:12px;'>Authorization request expired or already resolved.</div>";
      btnApprove.disabled = true;
      return;
    }

    const { origin, method, params, network, ticker } = res.request;
    reqOrigin.textContent = origin || "Unknown Application";
    netLabel.textContent = `Zcash ${network === "mainnet" ? "Mainnet" : "Testnet"}`;

    if (method === "zcash_connect" || method === "zcash_requestAccounts") {
      reqBadge.className = "req-type-badge badge-connect";
      reqBadge.textContent = "Connection Request";
      btnApprove.textContent = "Connect";

      dynamicDetails.innerHTML = `
        <div class="detail-row">
          <div class="detail-label">Permission Requested</div>
          <div class="detail-value" style="font-family:inherit; font-size:12px; line-height:1.5;">
            This website is requesting permission to view your Zcash public addresses, unified addresses, and account balances.
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Security Guarantee</div>
          <div class="detail-value" style="font-family:inherit; font-size:12px; line-height:1.5; color:#34d399;">
            ✓ The application CANNOT access your secret seed phrase, private keys, or spend your funds without explicit approval.
          </div>
        </div>
      `;
      secNotice.textContent = "Only connect to applications that you know and trust.";
      return;
    }

    if (method === "zcash_sendTransaction") {
      reqBadge.className = "req-type-badge badge-send";
      reqBadge.textContent = "Payment Authorization";
      btnApprove.textContent = "Confirm & Send";

      const txParam = Array.isArray(params) ? params[0] : (params || {});
      const to = txParam.to || "";
      const amount = parseFloat(txParam.amount || "0");
      const memo = txParam.memo || "";
      const fee = 0.0001;
      const total = amount + fee;

      const isShielded = to.startsWith("u") || to.startsWith("z");

      dynamicDetails.innerHTML = `
        <div class="detail-row">
          <div class="detail-label">Amount to Send</div>
          <div class="detail-value amount-highlight">
            ${amount.toFixed(4)} <span style="font-size:13px; color:var(--text);">${ticker}</span>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Recipient Address (${isShielded ? "Shielded" : "Transparent"})</div>
          <div class="detail-value">${escapeHtml(to)}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Network Fee (ZIP-317)</div>
          <div class="detail-value">${fee.toFixed(4)} ${ticker}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Total Deduction</div>
          <div class="detail-value" style="color:var(--gold); font-weight:700;">
            ${total.toFixed(4)} ${ticker}
          </div>
        </div>
        ${memo ? `
        <div class="detail-row">
          <div class="detail-label">Encrypted Memo</div>
          <div class="detail-value">${escapeHtml(memo)}</div>
        </div>` : ""}
      `;
      secNotice.textContent = "Verify the recipient address and amount carefully. Once confirmed and broadcasted, Zcash transactions cannot be reversed.";
      return;
    }

    if (method === "zcash_signMessage") {
      reqBadge.className = "req-type-badge badge-sign";
      reqBadge.textContent = "Signature Request";
      btnApprove.textContent = "Sign Message";

      const msgParam = Array.isArray(params) ? params[0] : (params || {});
      const message = typeof msgParam === "string" ? msgParam : (msgParam.message || JSON.stringify(msgParam));

      dynamicDetails.innerHTML = `
        <div class="detail-row">
          <div class="detail-label">Message to Sign</div>
          <div class="detail-value" style="max-height:140px; overflow-y:auto; font-size:11px;">
            ${escapeHtml(message)}
          </div>
        </div>
      `;
      secNotice.textContent = "Signing this message proves you control your address. Never sign a message from an unverified or suspicious origin.";
      return;
    }

    // Default generic method
    reqBadge.textContent = escapeHtml(method);
    dynamicDetails.innerHTML = `
      <div class="detail-row">
        <div class="detail-label">Method</div>
        <div class="detail-value">${escapeHtml(method)}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Parameters</div>
        <div class="detail-value">${escapeHtml(JSON.stringify(params, null, 2))}</div>
      </div>
    `;
  });

  function sendDecision(approved) {
    btnApprove.disabled = true;
    btnReject.disabled = true;
    chrome.runtime.sendMessage({
      type: "VEILX_RESOLVE_APPROVAL",
      id: reqId,
      approved,
    }, () => {
      window.close();
    });
  }

  btnApprove.addEventListener("click", () => sendDecision(true));
  btnReject.addEventListener("click", () => sendDecision(false));
})();
