const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

async function run() {
  const port = 9246;
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--disable-gpu",
    "--no-sandbox",
    "--window-size=1280,1100",
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
    if (!page) return;

    const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res) => { ws.onopen = res; });
    ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));

    await new Promise((r) => setTimeout(r, 2000));

    // 1. Click Cross-Chain
    await new Promise((res) => {
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === 10) {
          ws.removeEventListener("message", handler);
          res(msg.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({
        id: 10,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Cross-Chain'));
            if (b) b.click();
          })()`,
        },
      }));
    });

    await new Promise((r) => setTimeout(r, 1000));

    // 2. Click Demo Connect
    await new Promise((res) => {
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === 20) {
          ws.removeEventListener("message", handler);
          res(msg.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({
        id: 20,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Test in Demo Mode'));
            if (b) b.click();
          })()`,
        },
      }));
    });

    await new Promise((r) => setTimeout(r, 1500));

    // 3. Open Dropdown
    await new Promise((res) => {
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === 30) {
          ws.removeEventListener("message", handler);
          res(msg.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({
        id: 30,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('USD Coin') || x.innerText.includes('USDC'));
            if (b) b.click();
          })()`,
        },
      }));
    });

    await new Promise((r) => setTimeout(r, 1000));

    // Capture screenshot of Connected state + Open Dropdown
    const screenshotData = await new Promise((res) => {
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === 40) {
          ws.removeEventListener("message", handler);
          res(msg.result?.data);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({
        id: 40,
        method: "Page.captureScreenshot",
        params: { format: "png" },
      }));
    });

    if (screenshotData) {
      const outPath = path.join(__dirname, "../public/crosschain_connected_dropdown.png");
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
