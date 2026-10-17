const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

async function run() {
  const port = 9245;
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--disable-gpu",
    "--no-sandbox",
    "--window-size=1280,1000",
    "http://localhost:3000/tip/zooko",
  ]);

  await new Promise((r) => setTimeout(r, 2500));

  try {
    const list = await new Promise((res, rej) => {
      http.get(`http://127.0.0.1:${port}/json`, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(JSON.parse(d)));
      }).on("error", rej);
    });

    const page = list.find((p) => p.type === "page");
    if (!page) {
      console.log("No page found");
      return;
    }

    const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res) => { ws.onopen = res; });

    let exceptions = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === "Runtime.exceptionThrown") {
        exceptions.push(msg.params.exceptionDetails);
      }
    };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));

    await new Promise((r) => setTimeout(r, 2000));

    // Send click to "Cross-Chain" tab
    const clickCrossChain = `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const crossChainBtn = buttons.find(b => b.innerText.includes('Cross-Chain'));
        if (crossChainBtn) {
          crossChainBtn.click();
          return "Clicked Cross-Chain";
        }
        return "Cross-Chain button not found";
      })()
    `;

    const clickRes = await new Promise((res) => {
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === 10) {
          ws.removeEventListener("message", handler);
          res(msg.result?.result?.value);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({
        id: 10,
        method: "Runtime.evaluate",
        params: { expression: clickCrossChain },
      }));
    });

    console.log("Cross-Chain tab click:", clickRes);
    await new Promise((r) => setTimeout(r, 1500));

    // Query UI state after switching to Cross-Chain
    const checkState = `
      (() => {
        const connectBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Connect EVM'));
        const inputAmount = document.querySelector('input[type="number"]')?.value;
        const bodyText = document.body.innerText;
        return {
          hasConnectEvmButton: !!connectBtn,
          connectBtnText: connectBtn ? connectBtn.innerText.trim() : null,
          hasCrossChainActive: bodyText.includes('Connect EVM') || bodyText.includes('EVM Wallet'),
          hasAmountInput: !!document.querySelector('input[type="number"]'),
          bodySnippet: bodyText.slice(0, 500)
        };
      })()
    `;

    const stateRes = await new Promise((res) => {
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === 20) {
          ws.removeEventListener("message", handler);
          res(msg.result?.result?.value);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({
        id: 20,
        method: "Runtime.evaluate",
        params: { expression: checkState, returnByValue: true },
      }));
    });

    console.log("UI State in Cross-Chain mode:", JSON.stringify(stateRes, null, 2));

    // Capture screenshot
    const screenshotData = await new Promise((res) => {
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === 30) {
          ws.removeEventListener("message", handler);
          res(msg.result?.data);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({
        id: 30,
        method: "Page.captureScreenshot",
        params: { format: "png" },
      }));
    });

    if (screenshotData) {
      const outPath = path.join(__dirname, "../public/crosschain_tip_preview.png");
      fs.writeFileSync(outPath, Buffer.from(screenshotData, "base64"));
      console.log("Screenshot saved to", outPath);
    }

    ws.close();
  } catch (err) {
    console.error("Test error:", err);
  } finally {
    chrome.kill();
  }
}

run();
