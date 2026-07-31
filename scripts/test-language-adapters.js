import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { clearProjectScanCache, scanProject } from "../lib/projects/scan-project.js";
import { detectProjectLanguages } from "../lib/projects/detect.js";
import { discoverProjectFiles } from "../lib/projects/discover-files.js";
import { normalizeGraph, validateGraph } from "../lib/graph/schema.js";
import { openSourceInEditor } from "../lib/editors/registry.js";
import { resolveSemanticNodeId, semanticName } from "../lib/adapters/typescript-adapter.js";

const root = await mkdtemp(join(tmpdir(), "code-universe-languages-"));

try {
  await write("package.json", JSON.stringify({ name: "mixed-fixture", type: "module" }));
  await write("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }));
  await write("src/model.ts", `
export interface User {
  name: string;
}

export class UserService {
  load(): User {
    return { name: "Ada" };
  }
}
`);
  await write("src/App.tsx", `
import { UserService } from "./model";
import styles from "./App.module.css";

export function App() {
  const service = new UserService();
  const avatarPath = service.load().name;
  return <main id="app" className={styles.shell}>
    <a href="https://example.com/profile">Profile</a>
    <img src="../public/hero.png" alt="Profile hero" />
    <img src={avatarPath} alt="Dynamic profile" />
    {service.load().name}
  </main>;
}
`);
  await write("src/App.module.css", `
.shell { min-height: 100vh; }
`);
  await write("src/pages/Home.tsx", `
export default function Home() {
  return <section>Home</section>;
}
`);
  await write("public/index.html", `
<!doctype html>
<html>
  <head><link rel="stylesheet" href="./styles.css"></head>
  <body>
    <main id="app" class="shell">
      <nav>
        <a href="#details">Details</a>
        <a href="https://example.com/docs">Docs</a>
      </nav>
      <section id="details">
        <div>
          <span>Loaded</span>
        </div>
      </section>
      <picture>
        <source srcset="./hero.webp 1x, ./hero@2x.webp 2x">
        <img src="./hero.png" alt="Hero image" width="640" height="360" loading="lazy">
      </picture>
      <img src="https://example.com/avatar.png">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">
    </main>
    <script src="../src/App.tsx"></script>
  </body>
</html>
`);
  await write("public/styles.css", `
#app { color: red; }
.shell { display: grid; }
@keyframes appear { from { opacity: 0; } to { opacity: 1; } }
`);
  await write("src/gallery.js", `
const { speed, theme: galleryTheme } = { speed: 3, theme: "dark" };
var js_carousel_6e2a17c4 = new wsp_slideshow("carousel_6e2a17c4", [
  "../public/hero.png",
  "../public/missing-slide.jpg"
]);
const controls = {
  next() {
    document.getElementById("next").addEventListener("click", advance);
  },
  image: "../public/hero.png"
};
function outer() {
  function nested() { return document.querySelector("#gallery"); }
  return nested();
}
const commonModel = require("./model");
const loadHome = () => import("./pages/Home");
`);
  await write("public/assets.html", `
<!doctype html>
<html>
  <head>
    <base href="./">
    <link rel="icon" href="./hero.png">
    <style>
      #gallery { width: 80vw; height: 50vh; background-image: url("./hero.png"); }
      :root { --hero-size: 80vw; }
    </style>
  </head>
  <body>
    <main id="gallery">
      <button id="next">Next</button>
      <video poster="./hero.png"><source src="./movie.mp4"></video>
      <audio><source src="./sound.mp3"></audio>
      <iframe src="./manual.pdf" title="Manual"></iframe>
      <form action="/send"><input name="email"><button>Send</button></form>
      <a href="./manual.pdf" download>Manual</a>
      ${Array.from({ length: 70 }, (_, index) => `<section id="item-${index}">Item ${index}</section>`).join("\n      ")}
    </main>
    <script>
      const inlineSlides = ["./hero.png", "./missing-inline.jpg"];
      document.querySelector("#next").addEventListener("click", () => inlineSlides.length);
    </script>
  </body>
</html>
`);
  await write("public/hero.png", minimalPng(2, 3));
  await write("node_modules/ignored.js", "export const ignored = true;");

  const files = await discoverProjectFiles(root);
  assert(!files.some((file) => file.relative.includes("node_modules")), "generated dependency folders must be excluded");
  const detection = await detectProjectLanguages(root, files);
  assert(detection.primaryLanguage === "typescript", "tsconfig and TypeScript sources should select TypeScript as primary");
  assert(["typescript", "html", "css"].every((language) => detection.languages.some((entry) => entry.id === language)), "mixed web languages should all be detected");

  const { graph, diagnostics } = await scanProject(root, {
    profile: "balanced",
    legacyScanner: "merged",
    scanSwift: async () => {
      throw new Error("Swift adapter should not run for this fixture");
    }
  });
  const validation = validateGraph(graph);
  assert(validation.valid, validation.errors.join("; "));
  assert(graph.schemaVersion === 2, "adapter orchestration should emit schema v2");
  assert(graph.project.adapters.some((adapter) => adapter.id === "typescript"), "TypeScript adapter metadata should be recorded");
  assert(graph.project.adapters.some((adapter) => adapter.id === "web-assets"), "web adapter metadata should be recorded");
  assert(graph.project.adapters.some((adapter) => adapter.id === "project-assets"), "project image adapter metadata should be recorded");
  assert(graph.nodes.every((node) => node.hierarchy && Number.isInteger(node.hierarchy.depth)), "every node should have normalized spatial hierarchy metadata");
  assert(graph.nodes.every((node) => node.display && Number.isFinite(node.display.weight)), "every node should have normalized display metrics");
  assert(graph.nodes.every((node) => node.identity?.stableId), "every node should expose a cross-scan stable identity");
  assert(graph.nodes.some((node) => node.kind === "directory" && node.attributes?.path === "src"), "source folders should be represented as directory nodes");
  assert(graph.nodes.some((node) => node.kind === "react_component" && node.name === "App"), "TSX component should be detected");
  assert(graph.nodes.some((node) => node.kind === "interface" && node.name === "User"), "TypeScript interface should be detected");
  assert(graph.nodes.some((node) => node.kind === "css_rule" && node.name === "#app"), "CSS selector should be detected");
  const htmlDocument = graph.nodes.find((node) => node.kind === "html_document" && node.file === "public/index.html");
  const htmlMain = graph.nodes.find((node) => node.kind === "html_element" && node.name === "#app" && node.file === "public/index.html");
  assert(htmlDocument?.metrics?.lines === 24, `HTML document should report 24 physical lines, got ${htmlDocument?.metrics?.lines}`);
  assert(htmlDocument?.metrics?.divs === 1 && htmlDocument?.metrics?.spans === 1, "anonymous div and span elements should contribute to document metrics");
  assert(htmlDocument?.metrics?.elements === 17, `all seventeen DOM elements should contribute to complexity, got ${htmlDocument?.metrics?.elements}`);
  assert(htmlDocument?.metrics?.images === 3 && htmlDocument?.metrics?.missingAlt === 1, "images and missing alt text should contribute to HTML metrics");
  assert(htmlDocument?.metrics?.responsiveSources === 1, "responsive image sources should contribute to HTML metrics");
  assert(htmlDocument?.metrics?.complexity > 15, "nested markup and image accessibility should raise document complexity");
  assert(htmlMain?.metrics?.lines === 17, `element LOC should span opening through closing tag, got ${htmlMain?.metrics?.lines}`);
  assert(htmlMain?.endLine === htmlMain.line + 16, "element source range should end at its closing tag");
  assert(htmlMain?.metrics?.divs === 1 && htmlMain?.metrics?.spans === 1, "collapsed descendants should contribute to the visible parent subtree");
  assert(!graph.nodes.some((node) => node.kind === "html_element" && [".div", ".span"].includes(node.name)), "anonymous div and span elements should not add visual map noise");
  const detailsLink = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.href === "#details");
  const detailsTarget = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.id === "details");
  const externalLink = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.href === "https://example.com/docs");
  const externalTarget = graph.nodes.find((node) => node.kind === "module" && node.attributes?.href === "https://example.com/docs");
  assert(detailsLink?.name === "Details" && detailsLink.attributes?.navigation === true, "anchors should be inspectable HTML internals");
  assert(graph.edges.some((edge) => edge.from === detailsLink.id && edge.to === detailsTarget.id && edge.kind === "links_to"), "fragment links should connect to matching element IDs");
  assert(graph.edges.some((edge) => edge.from === externalLink.id && edge.to === externalTarget.id && edge.kind === "links_to"), "external anchors should connect to URL nodes");
  const describedImage = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.src === "./hero.png");
  const missingAltImage = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.src === "https://example.com/avatar.png");
  const decorativeImage = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.src?.startsWith("data:image/gif"));
  const picture = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.imageRole === "picture");
  const responsiveSource = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.imageRole === "source");
  const heroAsset = graph.nodes.find((node) => node.kind === "image_asset" && node.attributes?.path === "public/hero.png");
  const responsiveAssets = graph.nodes.filter((node) => node.kind === "image_asset" && node.attributes?.responsive);
  const externalImageAsset = graph.nodes.find((node) => node.kind === "image_asset" && node.attributes?.external);
  const embeddedImageAsset = graph.nodes.find((node) => node.kind === "image_asset" && node.attributes?.embedded);
  assert(describedImage?.name === "Hero image" && describedImage.attributes?.altStatus === "described", "image labels should prefer alt text and record accessibility status");
  assert(describedImage?.attributes?.width === 640 && describedImage.attributes?.height === 360 && describedImage.attributes?.loading === "lazy", "image dimensions and loading behavior should be recorded");
  assert(missingAltImage?.name === "avatar.png" && missingAltImage.attributes?.altStatus === "missing", "missing alt text should be explicit");
  assert(decorativeImage?.attributes?.altStatus === "decorative" && embeddedImageAsset, "empty alt text and embedded image sources should be represented");
  assert(picture?.name === "picture" && responsiveSource?.name === "hero.webp", "picture and source elements should always be inspectable");
  assert(heroAsset && responsiveAssets.length === 2 && externalImageAsset, "local, responsive, and external image assets should be represented");
  assert(graph.edges.some((edge) => edge.from === describedImage.id && edge.to === heroAsset.id && edge.kind === "displays"), "img src should connect to its image asset");
  assert(graph.edges.filter((edge) => edge.from === responsiveSource.id && edge.kind === "displays").length === 2, "srcset candidates should each create a displays connection");
  assert(graph.edges.some((edge) => edge.from === missingAltImage.id && edge.to === externalImageAsset.id && edge.kind === "displays"), "external image sources should create displays connections");
  assert(heroAsset.attributes?.exists === true && heroAsset.attributes?.pixelWidth === 2 && heroAsset.attributes?.pixelHeight === 3, "local image assets should validate existence and actual pixel dimensions");
  assert(heroAsset.hierarchy?.parentId === "directory:public" && heroAsset.display?.preview === "image", "image assets should be previewable objects under their project directory");
  assert(heroAsset.hierarchy?.shared === true && heroAsset.hierarchy?.sharedBy?.length > 1,
    "shared image assets should retain every consumer while using one primary spatial parent");
  assert(graph.nodes.some((node) => node.kind === "image_asset" && node.attributes?.broken), "missing local image references should be marked broken");
  const videoSource = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.src === "./movie.mp4");
  const audioSource = graph.nodes.find((node) => node.kind === "html_element" && node.attributes?.src === "./sound.mp3");
  assert(videoSource?.attributes?.mediaRole === "video" && audioSource?.attributes?.mediaRole === "audio", "source elements should inherit picture, video, or audio media context");
  assert(graph.nodes.some((node) => node.kind === "video_asset") && graph.nodes.some((node) => node.kind === "audio_asset"), "video and audio sources should use distinct asset kinds");
  assert(graph.nodes.some((node) => node.kind === "web_asset" && node.attributes?.path === "public/manual.pdf"), "embedded and downloadable documents should be first-class assets");
  assert(graph.nodes.some((node) => node.kind === "css_custom_property" && node.name === "--hero-size"), "inline CSS custom properties should be represented");
  assert(graph.edges.some((edge) => edge.kind === "embeds") && graph.edges.some((edge) => edge.kind === "downloads")
    && graph.edges.some((edge) => edge.kind === "submits_to"), "embeds, downloads, and form destinations should be connected");
  assert(graph.nodes.filter((node) => node.kind === "html_element" && node.file === "public/assets.html").length > 64, "large HTML documents should retain every meaningful internal");
  assert(graph.edges.some((edge) => edge.kind === "imports" && edge.from === "file:src/App.tsx" && edge.to === "file:src/model.ts"), "relative TypeScript imports should resolve to files");
  assert(graph.edges.some((edge) => edge.kind === "imports" && edge.from === "file:src/App.tsx" && edge.to === "file:src/App.module.css"), "CSS module imports should resolve to stylesheet files");
  assert(graph.edges.some((edge) => edge.kind === "loads" && edge.to === "file:public/styles.css"), "HTML stylesheet links should resolve");
  assert(graph.edges.some((edge) => edge.kind === "styles"), "CSS selectors should connect to matching HTML elements");
  const appNode = graph.nodes.find((node) => node.kind === "react_component" && node.name === "App");
  const loadNode = graph.nodes.find((node) => node.kind === "method" && node.name === "load");
  assert(appNode?.attributes?.framework === "react", "JSX components should record their detected framework");
  assert(graph.nodes.some((node) => node.name === "Home" && node.attributes?.framework === "nextjs"), "route conventions should identify Next.js components");
  assert(graph.edges.some((edge) => edge.from === appNode.id && edge.to === loadNode.id && edge.kind === "calls" && edge.source === "typescript-checker"), "type checker should resolve method calls through local variables");
  assert(graph.edges.some((edge) => edge.from === appNode.id && edge.kind === "styles" && edge.source === "css-modules"), "CSS module class usage should connect components to selector rules");
  assert(graph.nodes.some((node) => node.kind === "jsx_element" && node.attributes?.tag === "img"), "JSX internals should emit individual element nodes");
  assert(graph.edges.some((edge) => edge.kind === "displays"
    && graph.nodes.find((node) => node.id === edge.from)?.kind === "jsx_element"), "JSX images should connect to shared image assets");
  assert(graph.nodes.some((node) => node.kind === "image_asset" && node.attributes?.dynamic && node.attributes?.expression === "avatarPath"),
    "dynamic JSX image expressions should remain visible as ambiguous image assets");
  const carousel = graph.nodes.find((node) => node.kind === "variable" && node.name === "js_carousel_6e2a17c4");
  assert(carousel && graph.edges.filter((edge) => edge.from === carousel.id && edge.kind === "displays").length === 2, "JavaScript carousel arrays should expose static image assets");
  assert(graph.nodes.some((node) => node.kind === "method" && node.name === "next"), "object-literal methods should be represented");
  assert(graph.nodes.some((node) => node.kind === "function" && node.name === "nested"), "nested functions should be represented");
  assert(graph.nodes.some((node) => node.kind === "variable" && node.name === "speed")
    && graph.nodes.some((node) => node.kind === "variable" && node.name === "galleryTheme"), "destructured variables should be represented");
  assert(graph.edges.some((edge) => edge.source === "commonjs") && graph.edges.some((edge) => edge.source === "typescript-dynamic-import"), "CommonJS and dynamic imports should be represented");
  assert(graph.nodes.some((node) => node.kind === "inline_script"), "inline HTML scripts should be parsed as JavaScript modules");
  assert(graph.edges.some((edge) => edge.source === "dom-selector"
    && graph.nodes.find((node) => node.id === edge.to)?.attributes?.id === "next"), "DOM selectors and listeners should connect JavaScript to HTML elements");
  const throwingChecker = {
    getSymbolAtLocation() {
      throw new TypeError("Cannot read properties of undefined (reading 'flags')");
    }
  };
  assert(resolveSemanticNodeId(throwingChecker, {}, new Map()) === null, "semantic resolution failures should fall back to structural analysis");
  assert(semanticName(throwingChecker, {}) === null, "semantic-name failures should not abort a scan");
  const workerSource = await readFile(join(process.cwd(), "public/layout-worker.js"), "utf8");
  let workerResult = null;
  const workerSelf = {
    postMessage: (message) => {
      workerResult = message;
    }
  };
  runInNewContext(workerSource, { self: workerSelf });
  workerSelf.onmessage({ data: { graph } });
  assert(!workerResult?.error, workerResult?.error || "layout worker should return a result");
  assert(workerResult.layout.some((node) => node.kind === "image_asset"), "image assets should be visible in the main 3D layout");
  assert(workerResult.layout.some((node) => node.kind === "directory" && node.id === "directory:src"), "directory hierarchy should be visible in the 3D layout");
  const directoryLayouts = workerResult.layout.filter((node) => node.kind === "directory");
  assert(directoryLayouts.every((node) => node.y === 1), "nested directories should remain adjacent ground-level districts");
  assert(directoryLayouts.every((left, leftIndex) => directoryLayouts.every((right, rightIndex) =>
    leftIndex >= rightIndex
    || Math.abs(left.x - right.x) >= (left.width + right.width) / 2
    || Math.abs(left.z - right.z) >= (left.depth + right.depth) / 2)),
  "directory districts should not overlap");
  const nestedDirectory = directoryLayouts.find((node) => node.id === "directory:src/pages");
  assert(nestedDirectory?.parentId === "directory:src" && nestedDirectory.y === directoryLayouts.find((node) => node.id === "directory:src")?.y,
    "filesystem hierarchy should remain logical without vertical district nesting");
  const filesInDirectories = workerResult.layout.filter((node) => node.kind === "file" && node.parentId?.startsWith("directory:"));
  assert(filesInDirectories.every((file) => {
    const parent = workerResult.layout.find((node) => node.id === file.parentId);
    return parent
      && Math.abs(file.x - parent.x) + file.width / 2 <= parent.width / 2 + 0.01
      && Math.abs(file.z - parent.z) + file.depth / 2 <= parent.depth / 2 + 0.01;
  }), "file lots should fit inside their adjacent directory district");
  const laidOutDetails = workerResult.layout.find((node) => node.id === detailsTarget.id);
  const laidOutDetailsParent = workerResult.layout.find((node) => node.id === detailsTarget.hierarchy.parentId);
  assert(laidOutDetails?.parentId === laidOutDetailsParent?.id && laidOutDetails.y > laidOutDetailsParent.y,
    "nested DOM objects should retain their spatial parent and elevation");
  assert(diagnostics.adapters.some((adapter) => adapter.semanticIndex === "typescript-program" && adapter.semanticEdges > 0), "diagnostics should report the TypeScript semantic index");
  assert(diagnostics.filesScanned === 8, `expected 8 source files, got ${diagnostics.filesScanned}`);
  assert(diagnostics.cacheHit === false, "the first scan should not be served from cache");

  const cachedScan = await scanProject(root, {
    profile: "balanced",
    legacyScanner: "merged",
    scanSwift: async () => {
      throw new Error("Swift adapter should not run for this fixture");
    }
  });
  assert(cachedScan.diagnostics.cacheHit === true && cachedScan.diagnostics.fingerprint === diagnostics.fingerprint, "unchanged projects should reuse the fingerprinted scan");
  await write("src/App.module.css", ".shell { min-height: 100vh; display: grid; }\n");
  const changedScan = await scanProject(root, {
    profile: "balanced",
    legacyScanner: "merged",
    scanSwift: async () => {
      throw new Error("Swift adapter should not run for this fixture");
    }
  });
  assert(changedScan.diagnostics.cacheHit === false && changedScan.diagnostics.fingerprint !== diagnostics.fingerprint, "source changes should invalidate the project fingerprint");
  assert(changedScan.diagnostics.adapters.find((adapter) => adapter.adapter === "typescript")?.adapterCacheHit === true, "CSS content changes should reuse the TypeScript fragment");
  assert(changedScan.diagnostics.adapters.find((adapter) => adapter.adapter === "web-assets")?.adapterCacheHit === false, "CSS changes should invalidate the web-assets fragment");

  await write("public/styles.css", "#app { color: blue; }\n.shell { display: grid; }\n");
  const unrelatedCssScan = await scanProject(root, {
    profile: "balanced",
    legacyScanner: "merged",
    scanSwift: async () => {
      throw new Error("Swift adapter should not run for this fixture");
    }
  });
  assert(unrelatedCssScan.diagnostics.adapters.find((adapter) => adapter.adapter === "typescript")?.adapterCacheHit === true, "unrelated CSS changes should reuse the TypeScript fragment");

  await write("public/hero.png", Buffer.concat([minimalPng(4, 5), Buffer.from([0])]));
  const changedAssetScan = await scanProject(root, {
    profile: "balanced",
    legacyScanner: "merged",
    scanSwift: async () => {
      throw new Error("Swift adapter should not run for this fixture");
    }
  });
  assert(changedAssetScan.diagnostics.cacheHit === false, "asset metadata changes should invalidate the project fingerprint");
  assert(changedAssetScan.graph.nodes.some((node) => node.kind === "image_asset"
    && node.attributes?.path === "public/hero.png"
    && node.attributes?.pixelWidth === 4
    && node.attributes?.pixelHeight === 5), "rescans should refresh actual image dimensions");

  const legacy = normalizeGraph({
    schemaVersion: 1,
    project: { name: "Legacy", scannedAt: new Date().toISOString(), sourceRoot: root },
    nodes: [
      { id: "repo:root", kind: "repository", name: "Legacy", file: "", line: 1 },
      { id: "file:One.swift", kind: "file", name: "One.swift", file: "One.swift", line: 1 }
    ],
    edges: [{ from: "repo:root", to: "file:One.swift", kind: "contains" }]
  });
  assert(legacy.schemaVersion === 2 && legacy.nodes[1].language === "swift", "v1 graphs should normalize without losing Swift compatibility");
  const movedSymbol = (line) => normalizeGraph({
    schemaVersion: 2,
    project: { name: "Identity", sourceRoot: root },
    nodes: [
      { id: "repo:root", kind: "repository", name: "Identity", file: "", line: 1 },
      { id: `function:One.swift:run:${line}`, kind: "function", name: "run", qualifiedName: "One.run", file: "One.swift", line, endLine: line + 2 }
    ],
    edges: []
  }).nodes.find((node) => node.kind === "function");
  assert(movedSymbol(10).identity.stableId === movedSymbol(100).identity.stableId,
    "stable symbol identity should survive declaration line movement");

  const commands = [];
  const editorResult = await openSourceInEditor(
    { file: join(root, "src/App.tsx"), line: 4, column: 8, endLine: 9, endColumn: 2 },
    graph.project,
    {
      editor: "vscode",
      execFile: async (command, args) => commands.push({ command, args })
    }
  );
  assert(editorResult.editor === "vscode", "configured editor should be honored");
  assert(commands[0].args[1].endsWith(":4:8"), "editor navigation should include line and column");
  assert(editorResult.selection.end.line === 9 && editorResult.selection.end.column === 2,
    "editor handoff should retain the complete declaration range");

  await write("Mixed.csproj", `<Project Sdk="Microsoft.NET.Sdk"></Project>`);
  await write("dotnet/Models.cs", `
namespace Mixed;

public interface IRepository {
  User Find(int id);
}

public record User {
  public int Id { get; init; }
}

public class UserRepository : IRepository {
  public delegate void Loaded(User user);
  public event Loaded? DidLoad;
  public User Find(int id) { return new User(); }
}
`);
  await write("dotnet/App.cs", `
namespace Mixed;

public class App {
  public User Run() { var repository = new UserRepository(); return repository.Find(1); }
}
`);
  await write("Mixed.xcodeproj/project.pbxproj", "// fixture");
  await write("objc/Person.h", `
#import <Foundation/Foundation.h>

@protocol Greeter
- (NSString *)greet:(NSString *)name;
@end

@interface Person : NSObject <Greeter>
{
  NSString *_internalName;
}
@property (nonatomic, copy) NSString *displayName;
- (NSString *)greet:(NSString *)name;
- (void)run;
@end
`);
  await write("objc/Person.m", `
#import "Person.h"

@implementation Person
void (^completion)(NSString *) = ^(NSString *value) {};
- (NSString *)greet:(NSString *)name { return name; }
- (void)run { [self greet:@"Ada"]; }
@end
`);
  await write("objc/AppBridge.mm", `
#import "Person.h"

@interface AppBridge : NSObject
@end

@implementation AppBridge
@end
`);

  clearProjectScanCache();
  const expandedFiles = await discoverProjectFiles(root);
  const expandedDetection = await detectProjectLanguages(root, expandedFiles);
  assert(["csharp", "objective-c", "objective-cpp"].every((language) =>
    expandedDetection.languages.some((entry) => entry.id === language)
  ), "C#, Objective-C, and Objective-C++ should be detected");
  assert(expandedDetection.projectKind === "xcode", "an Xcode project should retain Xcode project detection in a mixed repository");

  const expandedScan = await scanProject(root, {
    profile: "balanced",
    legacyScanner: "merged",
    scanSwift: async () => {
      throw new Error("Swift adapter should not run for this fixture");
    }
  });
  const expandedGraph = expandedScan.graph;
  const expandedValidation = validateGraph(expandedGraph);
  assert(expandedValidation.valid, expandedValidation.errors.join("; "));
  assert(expandedGraph.project.adapters.some((adapter) => adapter.id === "csharp"), "C# adapter metadata should be recorded");
  assert(expandedGraph.project.adapters.some((adapter) => adapter.id === "objective-c"), "Objective-C adapter metadata should be recorded");
  assert(expandedGraph.nodes.some((node) => node.language === "csharp" && node.kind === "record" && node.name === "User"), "C# records should be detected");
  assert(expandedGraph.nodes.filter((node) => node.language === "csharp" && node.file)
    .every((node) => node.location?.range?.precision === "exact" && node.location.range.end.line >= node.location.range.start.line),
  "C# symbols should carry exact source ranges");
  assert(expandedGraph.nodes.some((node) => node.language === "csharp" && node.kind === "interface" && node.name === "IRepository"), "C# interfaces should be detected");
  assert(expandedGraph.nodes.some((node) => node.language === "csharp" && node.kind === "namespace" && node.name === "Mixed"), "C# namespaces should be represented");
  assert(expandedGraph.nodes.some((node) => node.language === "csharp" && node.kind === "delegate" && node.name === "Loaded"), "C# delegates should be represented");
  assert(expandedGraph.nodes.some((node) => node.language === "csharp" && node.kind === "event" && node.name === "DidLoad"), "C# events should be represented");
  assert(expandedGraph.edges.some((edge) => edge.kind === "implements"
    && expandedGraph.nodes.find((node) => node.id === edge.from)?.name === "UserRepository"
    && expandedGraph.nodes.find((node) => node.id === edge.to)?.name === "IRepository"), "C# interface conformance should resolve");
  assert(expandedGraph.edges.some((edge) => edge.kind === "calls"
    && expandedGraph.nodes.find((node) => node.id === edge.from)?.name === "Run"
    && expandedGraph.nodes.find((node) => node.id === edge.to)?.name === "Find"), "C# local method calls should resolve");
  assert(expandedGraph.nodes.some((node) => node.language === "objective-c" && node.kind === "protocol" && node.name === "Greeter"), "Objective-C protocols should be detected");
  assert(expandedGraph.nodes.some((node) => node.language === "objective-c" && node.kind === "property" && node.name === "displayName"), "Objective-C properties should be detected");
  assert(expandedGraph.nodes.some((node) => node.language === "objective-c" && node.kind === "ivar" && node.name === "_internalName"), "Objective-C ivars should be represented");
  assert(expandedGraph.nodes.some((node) => node.language === "objective-c" && node.kind === "block" && node.name === "completion"), "Objective-C blocks should be represented");
  assert(expandedGraph.nodes.some((node) => node.language === "objective-cpp" && node.kind === "class" && node.name === "AppBridge"), "Objective-C++ files should preserve their language");
  assert(expandedGraph.nodes.filter((node) => ["objective-c", "objective-cpp"].includes(node.language) && node.file)
    .every((node) => node.location?.range?.precision === "exact" && node.location.range.end.line >= node.location.range.start.line),
  "Objective-C symbols should carry exact source ranges");
  assert(expandedGraph.edges.some((edge) => edge.kind === "imports" && edge.from === "file:objc/Person.m" && edge.to === "file:objc/Person.h"), "Objective-C quoted imports should resolve to headers");
  assert(expandedGraph.edges.some((edge) => edge.kind === "conforms_to"
    && expandedGraph.nodes.find((node) => node.id === edge.from)?.name === "Person"
    && expandedGraph.nodes.find((node) => node.id === edge.to)?.name === "Greeter"), "Objective-C protocol conformance should resolve");
  assert(expandedGraph.edges.some((edge) => edge.kind === "calls"
    && expandedGraph.nodes.find((node) => node.id === edge.from)?.name === "run"
    && expandedGraph.nodes.find((node) => node.id === edge.to)?.name === "greet:"), "Objective-C message sends should resolve by selector");
  assert(expandedScan.diagnostics.adapters.some((adapter) => adapter.semanticIndex === "csharp-structural"), "C# structural diagnostics should be reported");
  assert(expandedScan.diagnostics.adapters.some((adapter) => adapter.semanticIndex === "objective-c-structural"), "Objective-C structural diagnostics should be reported");

  const swiftRoot = await mkdtemp(join(tmpdir(), "code-universe-swift-assets-"));
  try {
    await mkdir(join(swiftRoot, "Assets.xcassets/Logo.imageset"), { recursive: true });
    await writeFile(join(swiftRoot, "Assets.xcassets/Logo.imageset/logo.png"), minimalPng(8, 4));
    await writeFile(join(swiftRoot, "Assets.xcassets/Logo.imageset/Contents.json"), JSON.stringify({
      images: [{ filename: "logo.png", idiom: "universal", scale: "2x", appearances: [{ appearance: "luminosity", value: "dark" }] }],
      properties: { "preserves-vector-representation": true }
    }));
    await writeFile(join(swiftRoot, "View.swift"), "import SwiftUI\nstruct View: SwiftUI.View {\n  var body: some SwiftUI.View { Image(\"Logo\"); Image(systemName: \"star\"); Image(dynamicName) }\n}\n");
    const swiftScan = await scanProject(swiftRoot, {
      profile: "balanced",
      legacyScanner: "merged",
      scanSwift: async () => ({
        graph: {
          schemaVersion: 1,
          project: { name: "SwiftAssets", sourceRoot: swiftRoot },
          nodes: [
            { id: "repo:root", kind: "repository", name: "SwiftAssets", file: "", line: 1, metrics: {} },
            { id: "file:View.swift", kind: "file", name: "View.swift", file: "View.swift", line: 1, column: 1, endLine: 4, endColumn: 2, metrics: { lines: 4 } },
            { id: "type:View.swift:View", kind: "swiftui_view", name: "View", file: "View.swift", line: 2, column: 1, endLine: 4, endColumn: 2, metrics: { lines: 3 } },
            { id: "property:View.swift:View.body:3", kind: "property", name: "body", file: "View.swift", line: 3, column: 3, endLine: 3, endColumn: 55, metrics: { lines: 1 } }
          ],
          edges: [
            { from: "repo:root", to: "file:View.swift", kind: "contains" },
            { from: "file:View.swift", to: "type:View.swift:View", kind: "defines" },
            { from: "type:View.swift:View", to: "property:View.swift:View.body:3", kind: "defines" }
          ]
        },
        diagnostics: { scanner: "fixture", swiftFileCount: 1 }
      })
    });
    const logo = swiftScan.graph.nodes.find((node) => node.kind === "image_asset" && node.attributes?.assetName === "Logo");
    const body = swiftScan.graph.nodes.find((node) => node.kind === "property" && node.name === "body");
    assert(logo?.attributes?.pixelWidth === 8 && logo.attributes?.pixelHeight === 4, "Swift asset catalogs should expose image objects and dimensions");
    assert(logo.attributes?.variants?.[0]?.scale === "2x" && logo.attributes?.variants?.[0]?.appearances?.length === 1,
      "asset catalog scale and appearance metadata should be retained");
    assert(swiftScan.graph.edges.some((edge) => edge.from === body.id && edge.to === logo.id && edge.kind === "displays"),
      "Swift Image references should connect the enclosing symbol to the catalog asset");
    assert(swiftScan.graph.nodes.some((node) => node.kind === "image_asset" && node.attributes?.system && node.name === "star"),
      "SF Symbols should be represented as external system image assets");
    assert(swiftScan.graph.nodes.some((node) => node.kind === "image_asset" && node.attributes?.dynamic && node.attributes?.expression === "dynamicName"),
      "dynamic Swift image expressions should remain visible as ambiguous image assets");
  } finally {
    clearProjectScanCache();
    await rm(swiftRoot, { recursive: true, force: true });
  }

  console.log(`Language adapter tests passed with ${expandedGraph.nodes.length} nodes and ${expandedGraph.edges.length} edges.`);
} finally {
  clearProjectScanCache();
  await rm(root, { recursive: true, force: true });
}

async function write(path, source) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, typeof source === "string" ? source.trimStart() : source);
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
