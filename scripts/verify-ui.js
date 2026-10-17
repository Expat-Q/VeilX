const { spawn } = require("child_process");
const http = require("http");

async function snapshot(url, port) {
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--disable-gpu",
    "--no-sandbox",
    url,
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
      console.log(url, "=> No page found");
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

    // Wait 2 seconds for any React rendering
    await new Promise((r) => setTimeout(r, 2000));

    const evalResult = await new Promise((res) => {
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
        params: {
          expression: "document.title + ' --- ' + document.body.innerText.slice(0, 160).replace(/\\n/g, ' ')",
        },
      }));
    });

    console.log(`[PASS] ${url} (Exceptions: ${exceptions.length}) => ${evalResult}`);
    ws.close();
  } catch (err) {
    console.error(`Error checking ${url}:`, err.message);
  } finally {
    chrome.kill();
  }
}

async function main() {
  await snapshot("http://localhost:3000/", 9230);
  await snapshot("http://localhost:3000/dashboard", 9231);
  await snapshot("http://localhost:3000/tip/zooko", 9232);
}

main();
