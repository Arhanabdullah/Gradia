// Capture the app loader: sign in normally first, then delay Supabase
// responses and reload /app — the loader renders while the profile refetches.
import { createRequire } from "node:module";
import path from "node:path";
const require2 = createRequire(path.join("C:\\nvm4w\\nodejs\\node_modules", "noop.js"));
const puppeteer = require2("puppeteer-core");

const [url, outLoader] = process.argv.slice(2);
const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "dark"));

// 1. sign in (no delays)
await page.goto(url + "login", { waitUntil: "networkidle0", timeout: 60000 });
await page.type("input[type=email]", "arhan.abdullah307@gmail.com");
await page.type("input[type=password]", "Arhan@123");
await page.click("button[type=submit]");
for (let i = 0; i < 40; i += 1) {
    if (page.url().includes("/app")) break;
    await new Promise((r) => setTimeout(r, 500));
}
console.log("signed in, url:", page.url());

// 2. now delay supabase and reload — session is cached, profile refetch is slow
await page.setRequestInterception(true);
// delay only the profile fetch — holding the auth endpoints too makes
// supabase-js emit INITIAL_SESSION with null and bounce to /login
page.on("request", (req) => {
    if (req.url().includes("/rest/v1/profiles")) {
        setTimeout(() => req.continue(), 4000);
    } else {
        req.continue();
    }
});
await page.goto(url + "app", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: outLoader });

await browser.close();
console.log("saved:", outLoader);
