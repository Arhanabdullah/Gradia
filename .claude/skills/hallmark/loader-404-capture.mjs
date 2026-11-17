// Capture the 404 page (both themes) and the app loader (held open by
// delaying Supabase API responses with request interception).
import { createRequire } from "node:module";
import path from "node:path";
const require2 = createRequire(path.join("C:\\nvm4w\\nodejs\\node_modules", "noop.js"));
const puppeteer = require2("puppeteer-core");

const [url, out404Light, out404Dark, outLoader] = process.argv.slice(2);
const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

async function shot404(out) {
    await page.goto(url + "no-such-page", { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: out });
}

await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "light"));
await shot404(out404Light);

await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "dark"));
await shot404(out404Dark);

// Loader: intercept Supabase calls and delay them so the loading state is stable
await page.setRequestInterception(true);
page.on("request", (req) => {
    if (req.url().includes("supabase.co")) {
        setTimeout(() => req.continue(), 2500);
    } else {
        req.continue();
    }
});
await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "dark"));
await page.goto(url + "app", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: outLoader });

await browser.close();
console.log("saved:", out404Light, out404Dark, outLoader);
