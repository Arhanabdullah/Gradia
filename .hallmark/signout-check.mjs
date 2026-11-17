// Verify sign-out still works after the AuthContext loading fix.
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

await page.goto("http://localhost:5199/login", { waitUntil: "networkidle0", timeout: 60000 });
await page.type("input[type=email]", "arhan.abdullah307@gmail.com");
await page.type("input[type=password]", "Arhan@123");
await page.click("button[type=submit]");
for (let i = 0; i < 40; i += 1) {
    if (page.url().includes("/app")) break;
    await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 1200));

await page.click('[title="Sign out"]');
for (let i = 0; i < 20; i += 1) {
    if (page.url().includes("/login")) break;
    await new Promise((r) => setTimeout(r, 300));
}
console.log("3. after sign out ->", page.url().split("5199")[1]);

await page.goto("http://localhost:5199/app", { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 800));
console.log("4. signed-out /app revisit ->", page.url().split("5199")[1]);

await browser.close();
