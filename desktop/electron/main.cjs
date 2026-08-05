const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const { join } = require("node:path");
const { mkdirSync } = require("node:fs");

let mainWindow;
let serverProcess;
let quitting = false;
let serverError = "";

const explicitURL = process.env.CODE_UNIVERSE_URL;

function reservePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.unref();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const port = typeof address === "object" && address ? address.port : null;
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(baseURL) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(150 + attempt * 35, 1000)));
  }
  throw lastError || new Error("The Code Universe server did not become ready.");
}

function stopServer() {
  if (!serverProcess) return;
  serverProcess.kill();
  serverProcess = undefined;
}

async function startBundledServer() {
  if (explicitURL) return explicitURL;

  const root = app.getAppPath();
  const port = await reservePort();
  const dataRoot = join(app.getPath("userData"), "reviews");
  const cacheRoot = app.getPath("cache");
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(cacheRoot, { recursive: true });

  serverProcess = spawn(process.execPath, [join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      CODE_UNIVERSE_DATA_ROOT: dataRoot,
      CODE_UNIVERSE_CACHE_ROOT: cacheRoot,
      CODE_UNIVERSE_SWIFTSYNTAX_SCANNER: join(root, "bin", "scan-swift-syntax")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", () => {});
  serverProcess.stderr.on("data", chunk => {
    serverError = `${serverError}${chunk}`.slice(-4000);
  });
  serverProcess.on("exit", code => {
    if (!quitting && code !== 0) {
      const detail = serverError.trim();
      dialog.showErrorBox(
        "Code Universe",
        `The local analysis server stopped unexpectedly (${code}).${detail ? `\n\n${detail}` : ""}`
      );
    }
  });

  const baseURL = `http://127.0.0.1:${port}`;
  await waitForServer(baseURL);
  return baseURL;
}

function requestedScanPath() {
  const index = process.argv.indexOf("--scan-path");
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function createWindow() {
  const baseURL = await startBundledServer();
  const scanPath = requestedScanPath();
  const url = new URL(baseURL);
  if (scanPath) url.searchParams.set("scanPath", scanPath);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: "Code Universe",
    backgroundColor: "#071018",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(baseURL)) {
      event.preventDefault();
      if (/^https?:/i.test(target)) shell.openExternal(target);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  await mainWindow.loadURL(url.toString());
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady()
    .then(createWindow)
    .catch(error => {
      dialog.showErrorBox("Code Universe could not start", error.stack || error.message || String(error));
      app.quit();
    });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  stopServer();
});
