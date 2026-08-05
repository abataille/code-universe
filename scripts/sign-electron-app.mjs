import { sign } from "@electron/osx-sign";

const [appPath, identity, ...binaries] = process.argv.slice(2);

if (!appPath || !identity) {
  console.error("usage: sign-electron-app.mjs APP_PATH SIGN_IDENTITY [BINARY ...]");
  process.exit(2);
}

await sign({
  app: appPath,
  identity,
  platform: "darwin",
  binaries,
  hardenedRuntime: true,
  timestamp: "http://timestamp.apple.com/ts01"
});
