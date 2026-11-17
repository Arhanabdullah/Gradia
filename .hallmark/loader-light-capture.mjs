// Capture: light-theme loader + skip-link focus state on the landing page.
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

// light loader
await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "light"));
await page.goto("http://localhost:5199/login", { waitUntil: "networkidle0", timeout: 60000 });
await page.type("input[type=email]", "arhan.abdullah307@gmail.com");
await page.type("input[type=password]", "Arhan@123");
await page.click("button[type=submit]");
for (let i = 0; i < 40; i += 1) {
    if (page.url().includes("/app")) break;
    await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 1000));
await page.setRequestInterception(true);
page.on("request", (req) => {
    if (req.url().includes("/rest/v1/profiles")) {
        setTimeout(() => req.continue(), 4000);
    } else {
        req.continue();
    }
});
await page.evaluate(() => location.reload());
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: ".hallmark/shots/loader-light.png" });
console.log("saved loader-light");

// skip link focus on landing (dark)
await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "dark"));
await page.goto("http://localhost:5199/", { waitUntil: "networkidle0", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.keyboard.press("Tab");
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: ".hallmark/shots/skip-link.png", clip: { x: 0, y: 0, width: 720, height: 320 } });
console.log("saved skip-link");

await browser.close();
