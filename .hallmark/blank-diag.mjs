// Diagnose the blank screen after the loader releases: log console errors
// and DOM text at several timestamps after a real /app reload.
import { createRequire } from "node:module";
import path from "node:path";
const require2 = createRequire(path.join("C:\\nvm4w\\nodejs\\node_modules", "noop.js"));
const puppeteer = require2("puppeteer-core");

const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "dark"));
page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) console.log("CONSOLE-" + m.type().toUpperCase() + ":", m.text().slice(0, 200));
});
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 300)));

async function gotoRetry(url) {
    for (let i = 0; i < 10; i += 1) {
        try {
            await page.goto(url, { waitUntil: "networkidle0", timeout: 20000 });
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    throw new Error("server never came up: " + url);
}

await gotoRetry("http://localhost:5199/login");
await page.waitForSelector("input[type=email]", { timeout: 15000 });
await page.type("input[type=email]", "arhan.abdullah307@gmail.com");
await page.type("input[type=password]", "Arhan@123");
await page.click("button[type=submit]");
for (let i = 0; i < 40; i += 1) {
    if (page.url().includes("/app")) break;
    await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 1000));

console.log("--- reload ---");
await page.evaluate(() => location.reload());
for (const ms of [700, 1400, 2400, 4000]) {
    await new Promise((r) => setTimeout(r, ms === 700 ? 700 : ms - [700, 1400, 2400, 4000][[700, 1400, 2400, 4000].indexOf(ms) - 1]));
    const info = await page.evaluate(() => ({
        text: document.body.innerText.replace(/\s+/g, " ").slice(0, 120),
        hasLoader: !!document.querySelector(".loader-ring"),
        nodes: document.querySelectorAll("*").length,
    }));
    console.log(`t=${ms}ms`, "url:", page.url().split("5199")[1], "loader:", info.hasLoader, "nodes:", info.nodes, "text:", info.text || "(empty)");
}

await browser.close();
