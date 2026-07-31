import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";

const root = await mkdtemp(join(tmpdir(), "code-universe-visual-"));
const screenshot = join(tmpdir(), `code-universe-visual-${process.pid}.png`);
const languageScreenshot = join(tmpdir(), `code-universe-language-city-${process.pid}.png`);
const port = await availablePort();
let server;
let browser;

try {
  await write("src/gallery.js", `
export class GalleryController {
  hero = '../assets/hero.png';
  show() { return this.hero; }
  next() { return this.show(); }
}
`);
  await write("assets/hero.png", minimalPng(16, 9));
  await write("site/index.html", `
<!doctype html>
<html><body>
  <main id="gallery">
    <section id="hero"><div><span>Nested content</span></div><img src="../assets/hero.png" alt="Hero"></section>
    <nav><a href="#hero">Hero</a></nav>
  </main>
</body></html>
`);

  server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), CODE_UNIVERSE_SCANNER: "heuristic" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer(port);

  browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-webgl"]
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(`http://127.0.0.1:${port}/?scanPath=${encodeURIComponent(root)}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#pickerStatus")?.textContent?.startsWith("Loaded "), null, { timeout: 30_000 });
  await page.locator("#searchInput").fill("index.html");
  await page.locator("#searchInput").press("Enter");
  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshot });

  const htmlState = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const details = document.querySelector("#selectedDetails")?.textContent || "";
    return {
      canvasWidth: canvas?.width || 0,
      canvasHeight: canvas?.height || 0,
      startupError: details.includes("Startup error"),
      htmlSelected: details.includes("index.html") && details.includes("html"),
      hierarchyVisible: details.includes("Hierarchy"),
      stableIdentityVisible: details.includes("Stable identity")
    };
  });
  await page.locator("#searchInput").fill("GalleryController");
  await page.locator("#searchInput").press("Enter");
  await page.waitForTimeout(500);
  await page.screenshot({ path: languageScreenshot });
  const languageSelected = await page.evaluate(() =>
    (document.querySelector("#selectedDetails")?.textContent || "").includes("GalleryController"));
  const htmlImage = await readFile(screenshot);
  const languageImage = await readFile(languageScreenshot);
  assert(htmlImage.length > 40_000, `HTML city snapshot is unexpectedly small (${htmlImage.length} bytes)`);
  assert(languageImage.length > 40_000, `language city snapshot is unexpectedly small (${languageImage.length} bytes)`);
  assert(htmlState.canvasWidth >= 600 && htmlState.canvasHeight >= 400,
    `3D canvas should render inside the desktop viewport, got ${htmlState.canvasWidth}×${htmlState.canvasHeight}`);
  assert(!htmlState.startupError, "visual regression page should not show a startup error");
  assert(htmlState.htmlSelected, "visual regression should open the HTML file city");
  assert(languageSelected, "visual regression should open a programming-language building");
  assert(htmlState.hierarchyVisible && htmlState.stableIdentityVisible, "inspector should expose hierarchy and stable identity");
  assert(errors.length === 0, `browser console errors: ${errors.join("; ")}`);
  console.log(`Visual regression passed with ${htmlImage.length}/${languageImage.length} screenshot bytes at ${htmlState.canvasWidth}×${htmlState.canvasHeight}.`);
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  await rm(root, { recursive: true, force: true });
  await rm(screenshot, { force: true });
  await rm(languageScreenshot, { force: true });
}

async function write(path, source) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, typeof source === "string" ? source.trimStart() : source);
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", resolve).once("error", reject));
  const selected = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return selected;
}

async function waitForServer(selectedPort) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${selectedPort}/`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Visual regression server did not start.");
}

function minimalPng(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
