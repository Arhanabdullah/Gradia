// Force-light capture: emulate prefers-color-scheme: light AND seed localStorage.theme
// so Gradia's initTheme() takes the light branch (capture.mjs only emulates dark).
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const CHROMES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const chrome = CHROMES.find((x) => existsSync(x));
if (!chrome) { console.error("Chrome not found"); process.exit(1); }

const g = execSync("npm root -g", { encoding: "utf8" }).trim();
const req = createRequire(g + "\\noop.js");
const puppeteer = (await import(pathToFileURL(req.resolve("puppeteer-core")).href)).default;

const url = process.argv[2] ?? "http://localhost:5199/";
const out = process.argv[3] ?? "light-landing-1440.png";
const w = Number(process.argv[4] ?? 1440);
const h = Number(process.argv[5] ?? 900);

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const p = await browser.newPage();
await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
await p.evaluateOnNewDocument(() => localStorage.setItem("theme", "light"));
await p.setViewport({ width: w, height: h });
await p.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
await p.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
await p.screenshot({ path: out });
console.log("saved:", out);
await browser.close();
