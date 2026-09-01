import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { generateCommercialLicenseKeyPair, issueCommercialLicense } from "../lib/licensing/issuer.js";

const root = await mkdtemp(join(tmpdir(), "code-universe-visual-"));
const screenshot = join(tmpdir(), `code-universe-visual-${process.pid}.png`);
const languageScreenshot = join(tmpdir(), `code-universe-language-city-${process.pid}.png`);
const licenseScreenshot = join(tmpdir(), `code-universe-license-${process.pid}.png`);
const port = await availablePort();
const publicKeyPath = join(root, "license-public-key.pem");
const activatedLicensePath = join(root, "activated-license.json");
const importLicensePath = join(root, "team.license.json");
let server;
let browser;

try {
  const keys = generateCommercialLicenseKeyPair();
  const teamLicense = issueCommercialLicense({
    privateKey: keys.privateKey,
    customer: "Visual Test Team",
    edition: "team",
    licenseId: "visual-team-license",
    features: ["impact-reports", "team-policy"],
    notBefore: "2026-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z"
  });
  await writeFile(publicKeyPath, keys.publicKey);
  await writeFile(importLicensePath, `${JSON.stringify(teamLicense, null, 2)}\n`);
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
    env: {
      ...process.env,
      PORT: String(port),
      CODE_UNIVERSE_SCANNER: "heuristic",
      CODE_UNIVERSE_LICENSE_PUBLIC_KEY_PATH: publicKeyPath,
      CODE_UNIVERSE_LICENSE_PATH: activatedLicensePath
    },
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
  await page.locator("#compareParsersButton").click();
  await page.waitForFunction(() => {
    const text = document.querySelector("#parserDiff")?.textContent || "";
    return text.includes("Tree-sitter") || text.includes("parser comparison");
  }, null, { timeout: 30_000 });
  const comparisonState = await page.evaluate(() => ({
    analysisVisible: !document.querySelector("#inspectorPanelAnalysis")?.hidden,
    comparisonText: document.querySelector("#parserDiff")?.textContent || ""
  }));
  await page.locator("#licenseButton").click();
  await page.waitForSelector("[data-license-screen]:not(.is-loading)");
  await page.locator("#licenseFileInput").setInputFiles(importLicensePath);
  await page.waitForFunction(() => (document.querySelector("[data-license-screen]")?.textContent || "").includes("Commercial licence activated on this Mac."));
  const licenseState = await page.evaluate(() => {
    const drawer = document.querySelector("#contentDrawer");
    const text = drawer?.textContent || "";
    return {
      open: Boolean(drawer?.open),
      title: document.querySelector("#contentDrawerTitle")?.textContent || "",
      teamEdition: text.includes("Visual Test Team") && text.includes("Team"),
      verifiedLocally: text.includes("verified locally") || text.includes("Verified locally"),
      bslVisible: text.includes("BSL Additional Use Grant"),
      contactVisible: text.includes("Request a commercial licence")
    };
  });
  await page.screenshot({ path: licenseScreenshot });
  const htmlImage = await readFile(screenshot);
  const languageImage = await readFile(languageScreenshot);
  const licenseImage = await readFile(licenseScreenshot);
  if (process.env.CODE_UNIVERSE_VISUAL_OUTPUT_DIR) {
    await mkdir(process.env.CODE_UNIVERSE_VISUAL_OUTPUT_DIR, { recursive: true });
    await writeFile(join(process.env.CODE_UNIVERSE_VISUAL_OUTPUT_DIR, "license-screen.png"), licenseImage);
  }
  assert(htmlImage.length > 40_000, `HTML city snapshot is unexpectedly small (${htmlImage.length} bytes)`);
  assert(languageImage.length > 40_000, `language city snapshot is unexpectedly small (${languageImage.length} bytes)`);
  assert(licenseImage.length > 40_000, `licence screen snapshot is unexpectedly small (${licenseImage.length} bytes)`);
  assert(htmlState.canvasWidth >= 600 && htmlState.canvasHeight >= 400,
    `3D canvas should render inside the desktop viewport, got ${htmlState.canvasWidth}×${htmlState.canvasHeight}`);
  assert(!htmlState.startupError, "visual regression page should not show a startup error");
  assert(htmlState.htmlSelected, "visual regression should open the HTML file city");
  assert(languageSelected, "visual regression should open a programming-language building");
  assert(htmlState.hierarchyVisible && htmlState.stableIdentityVisible, "inspector should expose hierarchy and stable identity");
  assert(comparisonState.analysisVisible, "Compare Parsers should reveal the Analysis inspector tab");
  assert(comparisonState.comparisonText.includes("Tree-sitter"), "Compare Parsers should render a comparison result");
  assert(licenseState.open && licenseState.title === "Code Universe licence", "licence button should open the focused licence drawer");
  assert(licenseState.teamEdition && licenseState.verifiedLocally, "licence drawer should activate and display a verified Team licence");
  assert(licenseState.bslVisible && licenseState.contactVisible, "licence drawer should retain BSL context and commercial contact");
  assert(errors.length === 0, `browser console errors: ${errors.join("; ")}`);
  console.log(`Visual regression passed with ${htmlImage.length}/${languageImage.length} screenshot bytes at ${htmlState.canvasWidth}×${htmlState.canvasHeight}.`);
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  await rm(root, { recursive: true, force: true });
  await rm(screenshot, { force: true });
  await rm(languageScreenshot, { force: true });
  await rm(licenseScreenshot, { force: true });
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
