const { spawn } = require("child_process");
const http = require("http");

async function checkConsole() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const port = 9222;

  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--disable-gpu",
    "--no-sandbox",
    "http://localhost:3000/",
  ]);

  await new Promise((r) => setTimeout(r, 2000));

  try {
    const list = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(JSON.parse(data)));
      }).on("error", reject);
    });

    const page = list.find((p) => p.type === "page" && p.url.includes("localhost:3000"));
    if (!page || !page.webSocketDebuggerUrl) {
      console.log("Could not find localhost:3000 page:", list);
      chrome.kill();
      process.exit(1);
    }

    const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.exceptionThrown") {
        console.log("\n🚨 RUNTIME EXCEPTION THROWN:");
        console.log(JSON.stringify(msg.params.exceptionDetails, null, 2));
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        const type = msg.params.type;
        const args = msg.params.args.map((a) => a.value || a.description).join(" ");
        console.log(`[Console ${type}]`, args);
      }
    };

    // Wait 5 seconds to observe console and exceptions
    await new Promise((r) => setTimeout(r, 5000));
    ws.close();
  } catch (err) {
    console.error("Inspector error:", err);
  } finally {
    chrome.kill();
    process.exit(0);
  }
}

checkConsole();
