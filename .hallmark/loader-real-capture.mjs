// Verify the loader is visible under REAL conditions (no interception):
// reload /app signed in, screenshot at ~400ms (inside the 700ms hold),
// then at ~2s (dashboard restored).
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
try {
    await page.waitForSelector("input[type=email]", { timeout: 15000 });
} catch {
    const html = await page.evaluate(() => document.body.innerText.slice(0, 300));
    throw new Error("email field never appeared. url=" + page.url() + " body=" + html);
}
await page.type("input[type=email]", "arhan.abdullah307@gmail.com");
await page.type("input[type=password]", "Arhan@123");
await page.click("button[type=submit]");
for (let i = 0; i < 40; i += 1) {
    if (page.url().includes("/app")) break;
    await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 1000));

// real reload, no interception — loader must be visible thanks to the hold
await page.evaluate(() => location.reload());
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: ".hallmark/shots/loader-real.png" });
console.log("saved loader-real (t=400ms), url:", page.url());

await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: ".hallmark/shots/dashboard-after.png" });
console.log("saved dashboard-after (t=2.4s), url:", page.url());

await browser.close();
