// Capture chart hover states on the public landing, light and dark.
import { createRequire } from "node:module";
import path from "node:path";
const require2 = createRequire(path.join("C:\\nvm4w\\nodejs\\node_modules", "noop.js"));
const puppeteer = require2("puppeteer-core");

const [url, outLight, outDark] = process.argv.slice(2);
const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

async function hoverCapture(out) {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const info = await page.evaluate(() => {
        const charts = [...document.querySelectorAll(".recharts-wrapper")];
        const visible = charts.find((c) => c.offsetParent !== null);
        if (!visible) return null;
        visible.scrollIntoView({ block: "center", behavior: "instant" });
        const r = visible.getBoundingClientRect();
        // screenshot clips use page coordinates; rect is viewport-relative
        return {
            x: r.x + window.scrollX,
            y: r.y + window.scrollY,
            w: r.width,
            h: r.height,
        };
    });
    if (!info) throw new Error("no visible .recharts-wrapper");
    await new Promise((r) => setTimeout(r, 500));
    // activate the tooltip via a synthetic mousemove on the chart surface
    // (CDP-level hover proved unreliable with this app's smooth scrolling)
    await page.evaluate(() => {
        const c = [...document.querySelectorAll(".recharts-wrapper")].find(
            (x) => x.offsetParent !== null,
        );
        const r = c.getBoundingClientRect();
        const svg = c.querySelector("svg");
        for (const type of ["mouseenter", "mouseover", "mousemove"]) {
            svg.dispatchEvent(
                new MouseEvent(type, {
                    clientX: r.x + r.width * 0.6,
                    clientY: r.y + r.height * 0.4,
                    bubbles: true,
                }),
            );
        }
    });
    await new Promise((r) => setTimeout(r, 600));
    const clip = {
        x: Math.max(0, info.x - 80),
        y: Math.max(0, info.y - 70),
        width: Math.min(760, info.w + 160),
        height: Math.min(680, info.h + 140),
    };
    await page.screenshot({ path: out, clip });
}

// force light, capture
await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "light"));
await hoverCapture(outLight);

// force dark, capture
await page.evaluateOnNewDocument(() => localStorage.setItem("theme", "dark"));
await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await hoverCapture(outDark);

await browser.close();
console.log("saved:", outLight, "and", outDark);
