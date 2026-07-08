import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.querySelector("#worldCanvas");
const hoverTooltip = document.querySelector("#hoverTooltip");
const searchInput = document.querySelector("#searchInput");
const selectedDetails = document.querySelector("#selectedDetails");
const viewAllButton = document.querySelector("#viewAllButton");
const focusButton = document.querySelector("#focusButton");
const edgesButton = document.querySelector("#edgesButton");
const shareMapButton = document.querySelector("#shareMapButton");
const pickProjectButton = document.querySelector("#pickProjectButton");
const compareParsersButton = document.querySelector("#compareParsersButton");
const loadSampleButton = document.querySelector("#loadSampleButton");
const parserSelect = document.querySelector("#parserSelect");
const showFilesToggle = document.querySelector("#showFilesToggle");
const showModulesToggle = document.querySelector("#showModulesToggle");
const showProtocolsToggle = document.querySelector("#showProtocolsToggle");
const showPropertiesToggle = document.querySelector("#showPropertiesToggle");
const selectedEdgesOnlyToggle = document.querySelector("#selectedEdgesOnlyToggle");
const performanceModeToggle = document.querySelector("#performanceModeToggle");
const edgeUsesToggle = document.querySelector("#edgeUsesToggle");
const edgeImportsToggle = document.querySelector("#edgeImportsToggle");
const edgeConformsToggle = document.querySelector("#edgeConformsToggle");
const edgeDefinesToggle = document.querySelector("#edgeDefinesToggle");
const edgeStateToggle = document.querySelector("#edgeStateToggle");
const edgeMembersToggle = document.querySelector("#edgeMembersToggle");
const edgeInferredToggle = document.querySelector("#edgeInferredToggle");
const edgeIndexToggle = document.querySelector("#edgeIndexToggle");
const edgeDensitySelect = document.querySelector("#edgeDensitySelect");
const projectName = document.querySelector("#projectName");
const projectMeta = document.querySelector("#projectMeta");
const pickerStatus = document.querySelector("#pickerStatus");
const scanSummary = document.querySelector("#scanSummary");
const parserDiff = document.querySelector("#parserDiff");
const mapPresetButtons = document.querySelectorAll("[data-view-preset]");
const appShell = document.querySelector(".app-shell");
const toggleLeftRailButton = document.querySelector("#toggleLeftRailButton");
const toggleRightRailButton = document.querySelector("#toggleRightRailButton");

const colors = {
  repository: 0x45d9ff,
  file: 0x263746,
  swiftui_view: 0x18ff9a,
  service: 0xffc928,
  class: 0xff8a2a,
  model: 0xbd7bff,
  struct: 0xa970ff,
  enum: 0xff5ec4,
  protocol: 0x5aa8ff,
  function: 0xf6fbff,
  property: 0xff7ad9,
  module: 0x7d8cff
};

const geometryCache = new Map();
const materialCache = new Map();
const edgeGeometryCache = new Map();
const arrowHeadGeometry = new THREE.ConeGeometry(4.5, 11, 14);
const largeGraphNodeThreshold = 1200;
const largeGraphEdgeThreshold = 2500;
const edgeGeometryCacheLimit = 4000;
const fileChildGap = 4;
const lastProjectPathKey = "codeUniverse.lastProjectPath";
const parserModeKey = "codeUniverse.parserMode";
const clientIdKey = "codeUniverse.clientId";

const importantKinds = new Set(["file", "swiftui_view", "service", "class", "model", "struct", "enum", "protocol"]);

const state = {
  graph: null,
  layout: [],
  selectedId: null,
  selectedEdgeKey: null,
  openShellId: null,
  query: "",
  showEdges: true,
  edgeDensity: "normal",
  selectedEdgesOnly: false,
  focusMode: false,
  showFiles: true,
  showModules: true,
  showProtocols: true,
  showProperties: true,
  parserMode: "heuristic",
  parserComparison: null,
  performanceMode: false,
  edgeFilters: {
    uses: true,
    imports: false,
    conforms_to: false,
    defines: false,
    owns_state: false,
    uses_member: false,
    inferred: false,
    "xcode-index": false
  },
  pressedKeys: new Set(),
  pointer: new THREE.Vector2(),
  pointerDown: null,
  dragDistance: 0,
  meshById: new Map(),
  labelById: new Map(),
  nodeById: new Map(),
  layoutById: new Map(),
  edgesByFrom: new Map(),
  edgesByTo: new Map(),
  visibleNodeIds: new Set(),
  largeGraphMode: false,
  edgeRenderLimitHit: false,
  layoutPreparedInWorker: false,
  cameraAnimation: null,
  popupFocusTarget: null,
  hoveredId: null,
  filtersDirty: true,
  renderRequested: false,
  sourceContext: 12,
  mapRadius: 900
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1218);
scene.fog = new THREE.Fog(0x0a1218, 2600, 6200);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 12000);
const defaultCameraPosition = new THREE.Vector3(0, 360, 520);
const defaultControlsTarget = new THREE.Vector3(0, 70, 0);
camera.position.copy(defaultCameraPosition);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const raycaster = new THREE.Raycaster();
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.85;
controls.screenSpacePanning = true;
controls.minDistance = 180;
controls.maxDistance = 6000;
controls.target.copy(defaultControlsTarget);
controls.update();
controls.addEventListener("change", requestRender);

const universe = new THREE.Group();
const root = new THREE.Group();
const xrayRoot = new THREE.Group();
const edgeRoot = new THREE.Group();
const popupRoot = new THREE.Group();
const popupXrayRoot = new THREE.Group();
universe.add(root, xrayRoot, edgeRoot, popupRoot, popupXrayRoot);
scene.add(universe);

scene.add(new THREE.AmbientLight(0xb7c8d2, 0.85));
scene.add(new THREE.HemisphereLight(0xe8f7ff, 0x26343d, 1.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(-320, 560, 260);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb6e3f4, 0.75);
fillLight.position.set(420, 360, -520);
scene.add(fillLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(5000, 5000, 80, 80),
  getStandardMaterial("ground", { color: 0x081018, roughness: 0.92, metalness: 0.05 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -4;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(5000, 100, 0x263946, 0x14212a);
grid.position.y = -3.5;
scene.add(grid);

bootstrap().catch(showStartupError);

async function bootstrap() {
  registerWebClientLifecycle();
  initializeParserMode();
  bindEvents();
  resize();
  await loadInitialUniverse();
  requestRender();
}

function registerWebClientLifecycle() {
  const clientId = getClientId();
  const payload = () => JSON.stringify({ clientId });
  const postLifecycleEvent = (path, keepalive = false) => fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload(),
    keepalive
  }).catch(() => {});

  postLifecycleEvent("/api/client-open");
  const heartbeat = window.setInterval(() => {
    postLifecycleEvent("/api/client-heartbeat", true);
  }, 15000);

  window.addEventListener("pagehide", () => {
    window.clearInterval(heartbeat);
    const body = new Blob([payload()], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/client-close", body)) {
      postLifecycleEvent("/api/client-close", true);
    }
  });
}

function getClientId() {
  const existing = sessionStorage.getItem(clientIdKey);
  if (existing) return existing;
  const generated = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  sessionStorage.setItem(clientIdKey, generated);
  return generated;
}

function initializeParserMode() {
  state.parserMode = "heuristic";
  localStorage.setItem(parserModeKey, state.parserMode);
  parserSelect.value = state.parserMode;
}

async function loadInitialUniverse() {
  const requestedScanPath = new URLSearchParams(window.location.search).get("scanPath");
  if (requestedScanPath) {
    await loadSampleUniverse();
    try {
      await scanPath(requestedScanPath, "Xcode handoff scan");
    } catch (error) {
      showStartupError(error);
    }
    return;
  }

  const lastProjectPath = localStorage.getItem(lastProjectPathKey);
  await loadSampleUniverse();
  if (lastProjectPath) {
    pickerStatus.textContent = "Ready. Your last project is remembered; choose it again when you want a fresh scan.";
    scanSummary.textContent = `Last project: ${lastProjectPath}`;
  }
}

async function loadSampleUniverse() {
  pickerStatus.textContent = "Loaded bundled sample universe.";
  scanSummary.textContent = "Sample data only. Use the picker to analyze a real Xcode project.";
  const graph = await fetch("./sample-graph.json").then((response) => response.json());
  await loadGraph(graph, "Sample Swift app");
}

async function pickAndScanProject() {
  pickerStatus.textContent = "Opening native project picker...";
  scanSummary.textContent = "Waiting for project selection.";

  const response = await fetch("/api/pick-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scanner: state.parserMode })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Project scan failed.");
  }

  await loadGraph(payload.graph, "Native Xcode scan");
  focusSelectedFile(payload.diagnostics);
  const rememberedPath = payload.diagnostics.selectedFile ? payload.diagnostics.pickedPath : payload.diagnostics.sourceRoot;
  if (rememberedPath) {
    localStorage.setItem(lastProjectPathKey, rememberedPath);
  }
  pickerStatus.textContent = payload.diagnostics.selectedFile
    ? `Showing only ${payload.diagnostics.selectedFile} with ${describeParser(payload.diagnostics.scanner)}.`
    : `Loaded ${payload.graph.project.name} with ${describeParser(payload.diagnostics.scanner)}.`;
  scanSummary.textContent = formatScanSummary(payload.diagnostics);
}

async function scanPath(path, descriptor) {
  pickerStatus.textContent = "Reloading last project...";
  scanSummary.textContent = path;

  const response = await fetch("/api/scan-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, scanner: state.parserMode })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Project scan failed.");
  }

  await loadGraph(payload.graph, descriptor);
  focusSelectedFile(payload.diagnostics);
  const rememberedPath = payload.diagnostics.selectedFile ? payload.diagnostics.pickedPath : payload.diagnostics.sourceRoot;
  localStorage.setItem(lastProjectPathKey, rememberedPath);
  pickerStatus.textContent = payload.diagnostics.selectedFile
    ? `Showing only ${payload.diagnostics.selectedFile} with ${describeParser(payload.diagnostics.scanner)}.`
    : `Loaded ${payload.graph.project.name} with ${describeParser(payload.diagnostics.scanner)}.`;
  scanSummary.textContent = formatScanSummary(payload.diagnostics);
}

async function compareParsers() {
  const sourceRoot = state.graph?.project?.sourceRoot || localStorage.getItem(lastProjectPathKey);
  if (!sourceRoot) {
    parserDiff.innerHTML = "<p>Choose a real Xcode project first, then compare parsers.</p>";
    return;
  }

  parserDiff.innerHTML = "<p>Running fast heuristic and SwiftSyntax scans...</p>";
  const response = await fetch("/api/compare-parsers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: sourceRoot })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Parser comparison failed.");
  }

  state.parserComparison = payload;
  parserDiff.innerHTML = renderParserComparison(payload);
}

async function loadGraph(graph, descriptor) {
  state.graph = graph;
  state.largeGraphMode = isLargeGraph(graph);
  if (state.largeGraphMode) {
    state.performanceMode = true;
    performanceModeToggle.checked = true;
    renderer.setPixelRatio(1);
  }
  clearEdgeGeometryCache();
  updateGraphIndexes(graph);
  pickerStatus.textContent = state.largeGraphMode ? "Preparing a large graph in performance mode..." : pickerStatus.textContent;
  state.layout = await buildLayoutPrepared(graph);
  state.layoutById = new Map(state.layout.map((node) => [node.id, node]));
  state.selectedId = null;
  state.selectedEdgeKey = null;
  state.openShellId = null;
  state.query = "";
  state.hoveredId = null;
  state.showEdges = true;
  state.edgeDensity = "normal";
  state.meshById = new Map();
  state.labelById = new Map();
  searchInput.value = "";
  edgeDensitySelect.value = state.edgeDensity;
  mapPresetButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewPreset === "overview");
  });
  updateNavigationBounds();
  camera.position.copy(homeCameraPosition());
  controls.target.copy(defaultControlsTarget);
  controls.update();
  updateStats(graph, descriptor);
  buildScene();
  appendGraphScaleNotice();
  markFiltersDirty();
  selectNode(state.layout.find((item) => item.kind === "repository")?.id || state.layout[0]?.id);
  syncButtons();
}

function isLargeGraph(graph) {
  return graph.nodes.length > largeGraphNodeThreshold || graph.edges.length > largeGraphEdgeThreshold;
}

async function buildLayoutPrepared(graph) {
  if (!window.Worker) {
    state.layoutPreparedInWorker = false;
    return buildLayout(graph);
  }

  return new Promise((resolve) => {
    const worker = new Worker(new URL("./layout-worker.js", import.meta.url), { type: "module" });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      state.layoutPreparedInWorker = false;
      resolve(buildLayout(graph));
    }, state.largeGraphMode ? 12000 : 5000);

    worker.onmessage = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data?.layout) {
        state.layoutPreparedInWorker = true;
        resolve(event.data.layout);
      } else {
        state.layoutPreparedInWorker = false;
        resolve(buildLayout(graph));
      }
    };

    worker.onerror = () => {
      window.clearTimeout(timeout);
      worker.terminate();
      state.layoutPreparedInWorker = false;
      resolve(buildLayout(graph));
    };

    worker.postMessage({ graph });
  });
}

function focusSelectedFile(diagnostics) {
  const selectedFile = diagnostics?.selectedFile;
  if (!selectedFile) return;
  const fileNode = state.graph?.nodes.find((node) => node.kind === "file" && node.file === selectedFile);
  if (!fileNode) {
    pickerStatus.textContent = `Scanned folder, but could not find ${selectedFile} in the map.`;
    return;
  }
  selectNode(fileNode.id);
  pickerStatus.textContent = `Showing only ${selectedFile}.`;
}

function buildLayout(graph) {
  const files = graph.nodes.filter((node) => node.kind === "file");
  const types = graph.nodes.filter((node) => !["repository", "file", "module", "function", "property"].includes(node.kind));
  const functions = graph.nodes.filter((node) => node.kind === "function" || node.kind === "property");
  const modules = graph.nodes.filter((node) => node.kind === "module");
  const definesByFrom = groupEdgesByFrom(graph.edges, "defines");
  const layout = [];
  const layoutById = new Map();
  const fileChildTypesById = mapFileChildTypes(files, types, definesByFrom);
  const fileDistricts = packFileDistricts(files, fileChildTypesById);

  addLayoutNode(layout, layoutById, {
    ...graph.nodes.find((node) => node.kind === "repository"),
    ...gridPosition(0, 1, 170, 150, 0, -150),
    y: 0,
    ...dimensionsForNode({ kind: "repository" })
  });

  files.forEach((file, index) => {
    const dimensions = dimensionsForNode(file);
    const district = fileDistricts.get(file.id) || {
      ...fileDistrictDimensions(file, fileChildTypesById.get(file.id) || []),
      ...gridPosition(index, Math.max(1, files.length), 130, 110, 0, 20)
    };
    addLayoutNode(layout, layoutById, {
      ...file,
      ...dimensions,
      locWidth: dimensions.width,
      locDepth: dimensions.depth,
      width: Math.max(dimensions.width, district.width),
      depth: Math.max(dimensions.depth, district.depth),
      x: district.x,
      z: district.z,
      y: 0,
      visualWidth: Math.max(dimensions.width, district.width),
      visualDepth: Math.max(dimensions.depth, district.depth)
    });
  });

  files.forEach((file) => {
    const parent = layoutById.get(file.id);
    const childIds = new Set((definesByFrom.get(file.id) || []).map((edge) => edge.to));
    const childTypes = types.filter((candidate) => childIds.has(candidate.id));
    const childLayouts = [];
    childTypes.forEach((type, siblingIndex) => {
      const offset = childPositionOnFilePlane(siblingIndex, Math.max(1, childTypes.length), parent, childTypes);
      const dimensions = dimensionsForNode(type);
      const layoutNode = {
        ...type,
        ...dimensions,
        x: (parent?.x || 0) + offset.x,
        z: (parent?.z || 0) + offset.z,
        y: typeBaseYOnFile(parent),
        parentId: parent?.id || null
      };
      addLayoutNode(layout, layoutById, layoutNode);
      childLayouts.push(layoutNode);
    });
    separateSiblingObjects(childLayouts, fileChildGap);
  });

  types
    .filter((type) => !layoutById.has(type.id))
    .forEach((type, index, orphanTypes) => {
      const spacing = spacingForNodes(orphanTypes, 78, 68, 24);
      const position = gridPosition(index, Math.max(1, orphanTypes.length), spacing.x, spacing.z, 0, 210);
      addLayoutNode(layout, layoutById, {
        ...type,
        ...position,
        y: 48,
        ...dimensionsForNode(type)
      });
    });

  const fileBounds = boundsForLayout(layout.filter((item) => item.kind === "file"));
  const moduleOriginZ = fileBounds.minZ - 85;
  modules.forEach((moduleNode, index) => {
    addLayoutNode(layout, layoutById, {
      ...moduleNode,
      ...gridPosition(index, Math.max(1, modules.length), 92, 76, 0, moduleOriginZ),
      y: 72,
      ...dimensionsForNode(moduleNode)
    });
  });

  types.forEach((type) => {
    const parent = layoutById.get(type.id);
    if (!parent) return;
    const memberIds = new Set((definesByFrom.get(type.id) || []).map((edge) => edge.to));
    const members = functions.filter((candidate) => memberIds.has(candidate.id));
    const spacing = spacingForNodes(members, 24, 24, 12);
    members.forEach((node, index) => {
      const dimensions = dimensionsForNode(node);
      const position = memberPositionInsideType(index, Math.max(1, members.length), parent, spacing);
      addLayoutNode(layout, layoutById, {
        ...node,
        ...dimensions,
        x: parent.x + position.x,
        z: parent.z + position.z,
        y: memberBaseYInsideType(index, Math.max(1, members.length), parent, dimensions),
        parentId: parent.id
      });
    });
  });

  separateLargeObjects(layout);
  return layout;
}

function addLayoutNode(layout, layoutById, node) {
  layout.push(node);
  layoutById.set(node.id, node);
}

function updateGraphIndexes(graph) {
  state.nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  state.edgesByFrom = groupEdgesByFrom(graph.edges);
  state.edgesByTo = graph.edges.reduce((groups, edge) => {
    if (!groups.has(edge.to)) groups.set(edge.to, []);
    groups.get(edge.to).push(edge);
    return groups;
  }, new Map());
}

function groupEdgesByFrom(edges, kind = null) {
  return edges.reduce((groups, edge) => {
    if (kind && edge.kind !== kind) return groups;
    if (!groups.has(edge.from)) groups.set(edge.from, []);
    groups.get(edge.from).push(edge);
    return groups;
  }, new Map());
}

function mapFileChildTypes(files, types, definesByFrom) {
  const typesById = new Map(types.map((type) => [type.id, type]));
  return files.reduce((groups, file) => {
    const childTypes = (definesByFrom.get(file.id) || [])
      .map((edge) => typesById.get(edge.to))
      .filter(Boolean);
    groups.set(file.id, childTypes);
    return groups;
  }, new Map());
}

function packFileDistricts(files, fileChildTypesById) {
  if (files.length === 0) return new Map();
  const gap = 18;
  const districts = files.map((file) => ({
    file,
    ...fileDistrictDimensions(file, fileChildTypesById.get(file.id) || [])
  }));
  const totalArea = districts.reduce((sum, district) => sum + (district.width + gap) * (district.depth + gap), 0);
  const maxWidth = districts.reduce((value, district) => Math.max(value, district.width), 0);
  const targetWidth = Math.max(maxWidth, Math.sqrt(totalArea) * 1.08);
  const rows = [];
  let currentRow = [];
  let currentWidth = 0;
  let currentDepth = 0;

  districts.forEach((district) => {
    const nextWidth = currentRow.length === 0 ? district.width : currentWidth + gap + district.width;
    if (currentRow.length > 0 && nextWidth > targetWidth) {
      rows.push({ items: currentRow, width: currentWidth, depth: currentDepth });
      currentRow = [];
      currentWidth = 0;
      currentDepth = 0;
    }
    currentRow.push(district);
    currentWidth = currentWidth === 0 ? district.width : currentWidth + gap + district.width;
    currentDepth = Math.max(currentDepth, district.depth);
  });
  if (currentRow.length > 0) rows.push({ items: currentRow, width: currentWidth, depth: currentDepth });

  const totalDepth = rows.reduce((sum, row, index) => sum + row.depth + (index > 0 ? gap : 0), 0);
  let rowTop = 20 - totalDepth / 2;
  const positions = new Map();
  rows.forEach((row) => {
    let left = -row.width / 2;
    const centerZ = rowTop + row.depth / 2;
    row.items.forEach((district) => {
      const centerX = left + district.width / 2;
      positions.set(district.file.id, {
        x: centerX,
        z: centerZ,
        width: district.width,
        depth: district.depth
      });
      left += district.width + gap;
    });
    rowTop += row.depth + gap;
  });
  return positions;
}

function fileDistrictDimensions(file, childTypes = []) {
  const fileDimensions = dimensionsForNode(file);
  if (childTypes.length === 0) {
    return { width: fileDimensions.width, depth: fileDimensions.depth };
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(childTypes.length)));
  const rows = Math.max(1, Math.ceil(childTypes.length / columns));
  const spacing = spacingForNodes(childTypes, 38, 36, fileChildGap);
  const childDimensions = childTypes.map((type) => dimensionsForNode(type));
  const maxChildWidth = childDimensions.reduce((value, item) => Math.max(value, item.width || 0), 0);
  const maxChildDepth = childDimensions.reduce((value, item) => Math.max(value, item.depth || 0), 0);
  return {
    width: Math.max(fileDimensions.width, spacing.x * Math.max(1, columns - 1) + maxChildWidth + fileChildGap * 2),
    depth: Math.max(fileDimensions.depth, spacing.z * Math.max(1, rows - 1) + maxChildDepth + fileChildGap * 2)
  };
}

function separateLargeObjects(layout) {
  const movable = layout.filter((node) => !["repository", "file"].includes(node.kind) && !node.parentId);
  for (let iteration = 0; iteration < 5; iteration += 1) {
    for (let leftIndex = 0; leftIndex < movable.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < movable.length; rightIndex += 1) {
        pushApartIfOverlapping(movable[leftIndex], movable[rightIndex]);
      }
    }
  }
}

function separateContainedObjects(children, parent, padding = 4, gap = 18) {
  if (!parent || children.length < 2) return;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
        pushApartIfOverlapping(children[leftIndex], children[rightIndex], gap);
      }
    }
    children.forEach((child) => clampNodeToParentFootprint(child, parent, padding));
  }
}

function separateSiblingObjects(children, gap = 18) {
  if (children.length < 2) return;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
        pushApartIfOverlapping(children[leftIndex], children[rightIndex], gap);
      }
    }
  }
}

function clampNodeToParentFootprint(node, parent, padding = 4) {
  if (!node || !parent) return;
  const maxOffsetX = Math.max(0, ((parent.width || 0) - (node.width || 0)) / 2 - padding);
  const maxOffsetZ = Math.max(0, ((parent.depth || 0) - (node.depth || 0)) / 2 - padding);
  node.x = clamp(node.x || 0, (parent.x || 0) - maxOffsetX, (parent.x || 0) + maxOffsetX);
  node.z = clamp(node.z || 0, (parent.z || 0) - maxOffsetZ, (parent.z || 0) + maxOffsetZ);
}

function typeBaseYOnFile(fileNode) {
  return (fileNode?.y || 0) + (fileNode?.height || 0) + 4;
}

function memberPositionInsideType(index, total, parent, spacing) {
  if (!parent) return gridPosition(index, total, spacing.x, spacing.z);
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const usableWidth = Math.max(0, (parent.width || 0) * 0.68);
  const usableDepth = Math.max(0, (parent.depth || 0) * 0.68);
  const stepX = columns <= 1 ? 0 : Math.min(spacing.x, usableWidth / Math.max(1, columns - 1));
  const stepZ = rows <= 1 ? 0 : Math.min(spacing.z, usableDepth / Math.max(1, rows - 1));
  return {
    x: (column - (columns - 1) / 2) * stepX,
    z: (row - (rows - 1) / 2) * stepZ
  };
}

function memberBaseYInsideType(index, total, parent, dimensions) {
  const inset = 4;
  const minBase = (parent.y || 0) + inset;
  const maxBase = (parent.y || 0) + Math.max(inset, (parent.height || 0) - (dimensions.height || 0) - inset);
  if (maxBase <= minBase) return minBase;
  const t = total <= 1 ? 0.42 : index / Math.max(1, total - 1);
  return minBase + (maxBase - minBase) * t;
}

function pushApartIfOverlapping(left, right, gap = 18) {
  const minDistanceX = ((left.width || 0) + (right.width || 0)) / 2 + gap;
  const minDistanceZ = ((left.depth || 0) + (right.depth || 0)) / 2 + gap;
  const deltaX = (right.x || 0) - (left.x || 0);
  const deltaZ = (right.z || 0) - (left.z || 0);
  const overlapX = minDistanceX - Math.abs(deltaX);
  const overlapZ = minDistanceZ - Math.abs(deltaZ);
  if (overlapX <= 0 || overlapZ <= 0) return;

  if (overlapX < overlapZ) {
    const push = overlapX / 2;
    const direction = deltaX >= 0 ? 1 : -1;
    left.x -= push * direction;
    right.x += push * direction;
  } else {
    const push = overlapZ / 2;
    const direction = deltaZ >= 0 ? 1 : -1;
    left.z -= push * direction;
    right.z += push * direction;
  }
}

function buildScene() {
  disposeGroupMaterials(root);
  disposeGroupMaterials(edgeRoot);
  disposeGroupMaterials(popupRoot);
  root.clear();
  edgeRoot.clear();
  popupRoot.clear();
  state.meshById.clear();
  state.labelById.clear();
  state.edgeRenderLimitHit = false;
  const edgeBudget = renderEdgeBudget();
  let renderedEdges = 0;

  for (const node of state.layout) {
    if (node.kind === "repository") continue;
    if (node.kind === "function" || node.kind === "property") continue;
    const material = new THREE.MeshStandardMaterial({
      color: colorForNode(node),
      roughness: node.kind === "file" ? 0.78 : 0.48,
      metalness: node.kind === "swiftui_view" ? 0.28 : 0.16,
      emissive: emissiveForNode(node),
      emissiveIntensity: node.kind === "file" ? 0.04 : 0.18,
      transparent: isTranslucentCityObject(node.kind),
      opacity: cityObjectOpacity(node.kind),
      depthWrite: !isTranslucentCityObject(node.kind)
    });
    if (node.kind === "file") {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -1;
    }
    const geometry = makeNodeGeometry(node.kind, node.width, node.height, node.depth);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(node.x, (node.y || 0) + node.height / 2, node.z);
    applyKindRotation(mesh, node.kind);
    addCityBuildingDetails(mesh, node);
    addFileDistrictDetails(mesh, node);
    addCityObjectOutline(mesh, node);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      nodeId: node.id,
      defaultPosition: mesh.position.clone(),
      defaultScale: mesh.scale.clone(),
      defaultWireframe: material.wireframe,
      defaultOpacity: material.opacity,
      defaultTransparent: material.transparent,
      defaultDepthWrite: material.depthWrite,
      defaultEmissiveIntensity: material.emissiveIntensity
    };
    root.add(mesh);
    state.meshById.set(node.id, mesh);

    if (shouldCreateSearchHalo(node)) {
      const halo = makeSearchHalo(node);
      halo.position.set(node.x, (node.y || 0) + node.height + 12, node.z);
      halo.userData = {
        nodeId: node.id,
        role: "search-halo"
      };
      halo.visible = false;
      root.add(halo);
    }

    if (node.kind === "file") {
      const fileMarker = makeFileMarker(node);
      fileMarker.position.set(node.x, (node.y || 0) + node.height + 0.6, node.z);
      fileMarker.userData = {
        nodeId: node.id,
        role: "file-marker",
        defaultPosition: fileMarker.position.clone()
      };
      root.add(fileMarker);
    }

    if (importantKinds.has(node.kind) || node.kind === "function" || node.kind === "property") {
      const label = makeLabel(
        node.name,
        node.kind === "swiftui_view" ? "#dfffee" : node.kind === "function" || node.kind === "property" ? "#f2f6f8" : "#d9e7ee",
        node.kind === "function" || node.kind === "property" ? 48 : 68,
        node.kind === "function" || node.kind === "property" ? 10 : 13
      );
      label.position.set(node.x, (node.y || 0) + node.height + 18, node.z);
      label.userData = {
        nodeId: node.id,
        defaultPosition: label.position.clone()
      };
      label.visible = importantKinds.has(node.kind);
      root.add(label);
      state.labelById.set(node.id, label);
    }
  }

  for (const [edgeIndex, edge] of state.graph.edges.entries()) {
    if (!isMainEdgeRenderable(edge)) continue;
    if (!isEdgeVisible(edge)) continue;
    if (renderedEdges >= edgeBudget) {
      state.edgeRenderLimitHit = true;
      continue;
    }
    const from = state.layoutById.get(edge.from);
    const to = state.layoutById.get(edge.to);
    if (!from || !to) continue;
    edge.__renderKey = edge.__renderKey || edgeKey(edge, edgeIndex);
    const curve = streetCurveForEdge(from, to);
    const color = edgeRenderColor(edge);
    const points = curve.getPoints(28);
    const streetGeometry = getEdgeTubeGeometry(edge, from, to, "street", curve, edgeTubeRadius(edge) * 3.4);
    const streetMaterial = new THREE.MeshBasicMaterial({
      color: 0x111a20,
      transparent: true,
      opacity: edgeOpacity(edge) * 0.48,
      depthWrite: false
    });
    const street = new THREE.Mesh(streetGeometry, streetMaterial);
    const geometry = getEdgeTubeGeometry(edge, from, to, "line", curve, edgeTubeRadius(edge) * 0.78);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: Math.min(1, edgeOpacity(edge) * 1.08),
      depthWrite: false
    });
    const line = new THREE.Mesh(geometry, material);
    const arrow = makeArrowHead(points, color);
    arrow.material.opacity = edgeOpacity(edge);
    const group = new THREE.Group();
    street.userData.edge = edge;
    line.userData.edge = edge;
    arrow.userData.edge = edge;
    group.add(street, line, arrow);
    group.userData.edge = edge;
    group.userData.edgeKey = edgeKey(edge);
    group.userData.streetMaterial = streetMaterial;
    group.userData.lineMaterial = material;
    group.userData.arrowMaterial = arrow.material;
    edgeRoot.add(group);
    renderedEdges += 1;
  }
}

function renderEdgeBudget() {
  if (state.edgeDensity === "everything") return state.largeGraphMode ? 900 : 2400;
  if (state.edgeDensity === "clean") return state.largeGraphMode ? 450 : 1200;
  return state.largeGraphMode ? 700 : 1800;
}

function getEdgeTubeGeometry(edge, from, to, role, curve, radius) {
  const key = [
    edge.__renderKey || edgeKey(edge),
    role,
    Math.round(from.x),
    Math.round(from.y || 0),
    Math.round(from.z),
    Math.round(to.x),
    Math.round(to.y || 0),
    Math.round(to.z),
    Math.round(radius * 100)
  ].join(":");
  let geometry = edgeGeometryCache.get(key);
  if (!geometry) {
    geometry = getCachedTubeGeometry(key, curve, 28, radius);
  }
  return geometry;
}

function getCachedTubeGeometry(key, curve, segments, radius) {
  let geometry = edgeGeometryCache.get(key);
  if (!geometry) {
    geometry = new THREE.TubeGeometry(curve, segments, radius, 6, false);
    edgeGeometryCache.set(key, geometry);
    capEdgeGeometryCache();
  }
  return geometry;
}

function capEdgeGeometryCache() {
  while (edgeGeometryCache.size > edgeGeometryCacheLimit) {
    const [oldestKey, geometry] = edgeGeometryCache.entries().next().value;
    geometry.dispose?.();
    edgeGeometryCache.delete(oldestKey);
  }
}

function clearEdgeGeometryCache() {
  for (const geometry of edgeGeometryCache.values()) {
    geometry.dispose?.();
  }
  edgeGeometryCache.clear();
}

function disposeGroupMaterials(group) {
  group.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    materials.forEach((material) => {
      if (!materialCacheHas(material)) {
        material.map?.dispose?.();
        material.dispose?.();
      }
    });
  });
}

function materialCacheHas(material) {
  for (const cached of materialCache.values()) {
    if (cached === material) return true;
  }
  return false;
}

function streetCurveForEdge(from, to) {
  const fromRadius = Math.max(from.width || 0, from.depth || 0) * 0.52 + 10;
  const toRadius = Math.max(to.width || 0, to.depth || 0) * 0.52 + 10;
  const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  if (direction.lengthSq() < 1) direction.set(1, 0, 0);
  direction.normalize();
  const startY = Math.max(5, (from.y || 0) + Math.min(from.height || 0, 6));
  const endY = Math.max(5, (to.y || 0) + Math.min(to.height || 0, 6));
  const streetY = Math.max(5, Math.min(startY, endY));
  const start = new THREE.Vector3(from.x + direction.x * fromRadius, streetY, from.z + direction.z * fromRadius);
  const end = new THREE.Vector3(to.x - direction.x * toRadius, streetY + 0.4, to.z - direction.z * toRadius);
  const route = new THREE.CurvePath();
  const horizontalFirst = Math.abs(end.x - start.x) > Math.abs(end.z - start.z);
  const jog = rectangularStreetJog(start, end, horizontalFirst);
  [start, ...jog, end].forEach((point, index, points) => {
    if (index === 0) return;
    const previous = points[index - 1];
    if (previous.distanceTo(point) > 0.1) {
      route.add(new THREE.LineCurve3(previous, point));
    }
  });
  return route;
}

function rectangularStreetJog(start, end, horizontalFirst) {
  const laneOffset = laneOffsetForStreet(start, end);
  if (horizontalFirst) {
    const midX = (start.x + end.x) / 2 + laneOffset;
    return [
      new THREE.Vector3(midX, start.y, start.z),
      new THREE.Vector3(midX, end.y, end.z)
    ];
  }
  const midZ = (start.z + end.z) / 2 + laneOffset;
  return [
    new THREE.Vector3(start.x, start.y, midZ),
    new THREE.Vector3(end.x, end.y, midZ)
  ];
}

function laneOffsetForStreet(start, end) {
  const hash = Math.sin((start.x * 12.9898 + start.z * 78.233 + end.x * 37.719 + end.z * 11.131) * 0.001) * 43758.5453;
  return (hash - Math.floor(hash) - 0.5) * 34;
}

function applyKindRotation(mesh, kind) {
  if (kind === "protocol") {
    mesh.rotation.y = Math.PI / 4;
  }
}

function addCityBuildingDetails(mesh, node) {
  if (!isStructuralBuilding(node.kind) || node.height < 28) return;
  const tint = complexityTintForNode(node);
  const warmAccent = tint > 0.72;
  const floorMaterial = getBasicMaterial(`floor-band:${node.kind}`, {
    color: warmAccent ? 0xffb84d : 0x5ee7ff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false
  });
  const podiumMaterial = getBasicMaterial(`podium:${node.kind}`, {
    color: 0x071017,
    transparent: true,
    opacity: 0.62,
    depthWrite: false
  });
  const capMaterial = getBasicMaterial(`roof:${node.kind}`, {
    color: warmAccent ? 0xfff0ad : 0xbff8ff,
    transparent: true,
    opacity: 0.34,
    depthWrite: false
  });
  const levels = clamp(Math.floor(node.height / 18), 2, 14);
  const sideYStart = -node.height / 2 + node.height / (levels + 1);

  const podiumHeight = clamp(node.height * 0.12, 4, 18);
  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(node.width * 1.08, podiumHeight, node.depth * 1.08),
    podiumMaterial
  );
  podium.position.set(0, -node.height / 2 + podiumHeight / 2 + 0.3, 0);
  mesh.add(podium);

  for (let level = 0; level < levels; level += 1) {
    const y = sideYStart + level * (node.height / (levels + 1));
    if (level % 2 === 0 || level === levels - 1) {
      const frontBand = new THREE.Mesh(new THREE.BoxGeometry(node.width * 0.88, 0.65, 0.7), floorMaterial);
      frontBand.position.set(0, y, node.depth / 2 + 0.38);
      mesh.add(frontBand);
      const sideBand = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.65, node.depth * 0.88), floorMaterial);
      sideBand.position.set(node.width / 2 + 0.38, y, 0);
      mesh.add(sideBand);
    }
  }

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(5, node.width * 0.72), Math.max(2, node.height * 0.04), Math.max(5, node.depth * 0.72)),
    capMaterial
  );
  roof.position.set(0, node.height / 2 + Math.max(1.2, node.height * 0.025), 0);
  mesh.add(roof);

  if (node.height > 70) {
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 1.1, clamp(node.height * 0.12, 8, 24), 8),
      capMaterial
    );
    antenna.position.set(node.width * 0.22, node.height / 2 + clamp(node.height * 0.08, 6, 16), node.depth * 0.18);
    mesh.add(antenna);
  }
}

function addCityObjectOutline(mesh, node) {
  if (node.kind === "file" || node.kind === "module") return;
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: complexityTintForNode(node) > 0.72 ? 0xfff1a8 : 0xbff8ff,
    transparent: true,
    opacity: isStructuralBuilding(node.kind) ? 0.72 : 0.48,
    depthWrite: false
  });
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(makeNodeGeometry(node.kind, node.width * 1.01, node.height * 1.01, node.depth * 1.01)),
    outlineMaterial
  );
  outline.userData = { role: "city-outline" };
  mesh.add(outline);
}

function addFileDistrictDetails(mesh, node) {
  if (node.kind !== "file") return;
  const roadMaterial = getBasicMaterial("file-district-road", {
    color: 0x1d313b,
    transparent: true,
    opacity: 0.78,
    depthWrite: false
  });
  const glowMaterial = getBasicMaterial("file-district-glow", {
    color: 0x63d2ff,
    transparent: true,
    opacity: 0.24,
    depthWrite: false
  });
  const topY = node.height / 2 + 0.42;
  const roadCountX = clamp(Math.floor(node.width / 58), 1, 6);
  const roadCountZ = clamp(Math.floor(node.depth / 46), 1, 5);

  for (let index = 1; index <= roadCountX; index += 1) {
    const x = -node.width / 2 + (node.width / (roadCountX + 1)) * index;
    const road = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.38, node.depth * 0.82), roadMaterial);
    road.position.set(x, topY, 0);
    mesh.add(road);
  }

  for (let index = 1; index <= roadCountZ; index += 1) {
    const z = -node.depth / 2 + (node.depth / (roadCountZ + 1)) * index;
    const road = new THREE.Mesh(new THREE.BoxGeometry(node.width * 0.82, 0.38, 1.2), roadMaterial);
    road.position.set(0, topY + 0.04, z);
    mesh.add(road);
  }

  const markerSize = clamp(Math.min(node.width, node.depth) * 0.06, 2.8, 8);
  [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ].forEach(([xSide, zSide]) => {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(markerSize, 0.5, markerSize), glowMaterial);
    marker.position.set(xSide * node.width * 0.38, topY + 0.12, zSide * node.depth * 0.36);
    mesh.add(marker);
  });
}

function isStructuralBuilding(kind) {
  return ["swiftui_view", "service", "class", "model", "struct", "enum"].includes(kind);
}

function isTranslucentCityObject(kind) {
  return kind === "file";
}

function cityObjectOpacity(kind) {
  if (kind === "file") return 0.52;
  return 1;
}

function colorForNode(node) {
  const base = new THREE.Color(colors[node.kind] || 0x95a4ad);
  if (node.kind === "file") return base.getHex();
  const complexityTint = complexityTintForNode(node);
  const spectrum = spectrumColorForComplexity(complexityTint);
  const blend = isStructuralBuilding(node.kind) ? 0.12 + complexityTint * 0.24 : 0.14 + complexityTint * 0.28;
  return base.lerp(spectrum, blend).getHex();
}

function emissiveForNode(node) {
  const base = new THREE.Color(node.kind === "file" ? 0x03090d : colors[node.kind] || 0x000000);
  const complexityTint = complexityTintForNode(node);
  const spectrum = spectrumColorForComplexity(complexityTint);
  return base.lerp(spectrum, node.kind === "file" ? 0.08 : 0.24 + complexityTint * 0.22).getHex();
}

function spectrumColorForComplexity(value) {
  const stops = [
    { at: 0, color: new THREE.Color(0x3a7bd5) },
    { at: 0.25, color: new THREE.Color(0x00d2ff) },
    { at: 0.5, color: new THREE.Color(0x4ade80) },
    { at: 0.75, color: new THREE.Color(0xffd166) },
    { at: 1, color: new THREE.Color(0xff4d4d) }
  ];
  const clampedValue = clamp(value, 0, 1);
  const upperIndex = stops.findIndex((stop) => stop.at >= clampedValue);
  const upper = stops[Math.max(upperIndex, 1)];
  const lower = stops[Math.max(0, stops.indexOf(upper) - 1)];
  const span = Math.max(0.001, upper.at - lower.at);
  return lower.color.clone().lerp(upper.color, (clampedValue - lower.at) / span);
}

function complexityTintForNode(node) {
  if (!node || node.kind === "repository" || node.kind === "module") return 0;
  const axis = axisMetricsForNode(node);
  const score = Math.log1p(axis.lines) * 0.42
    + Math.sqrt(axis.variables) * 0.72
    + Math.sqrt(axis.functions) * 0.86
    + (node.metrics?.branches || 0) * 0.18
    + Math.sqrt(node.metrics?.calls || 0) * 0.12;
  return clamp(score / 8.5, 0, 1);
}

function draw() {
  state.renderRequested = false;
  applyCameraAnimation();
  if (!state.graph || state.layout.length === 0) {
    applyKeyboardNavigation();
    controls.update();
    renderer.render(scene, camera);
    scheduleRenderIfAnimating();
    return;
  }
  applyKeyboardNavigation();
  if (state.filtersDirty) {
    applyFilters();
    state.filtersDirty = false;
  }
  controls.update();
  renderer.render(scene, camera);
  scheduleRenderIfAnimating();
}

function markFiltersDirty() {
  state.filtersDirty = true;
  requestRender();
}

function requestRender() {
  if (state.renderRequested) return;
  state.renderRequested = true;
  requestAnimationFrame(draw);
}

function scheduleRenderIfAnimating() {
  if (state.cameraAnimation || state.pressedKeys.size > 0) {
    requestRender();
  }
}

function applyFilters() {
  if (!state.graph) return;
  const neighborhood = focusedNeighborhood();
  resetDynamicLayout();
  disposeGroupMaterials(xrayRoot);
  disposeGroupMaterials(popupXrayRoot);
  xrayRoot.clear();
  popupXrayRoot.clear();
  state.visibleNodeIds = new Set();
  root.children.forEach((object) => {
    const nodeId = object.userData.nodeId;
    if (!nodeId) return;
    const node = state.layoutById.get(nodeId);
    const matched = isSearchMatch(node);
    const visible = isNodeVisible(node, neighborhood);
    if (visible) state.visibleNodeIds.add(nodeId);
    if (object.userData.role === "search-halo") {
      object.visible = visible && matched;
      return;
    }
    if (object.type === "Sprite") {
      object.visible = visible && shouldShowLabel(nodeId);
      return;
    }
    object.visible = visible && shouldShowMesh(nodeId);
    const dim = state.query && !matched && nodeId !== state.selectedId;
    if (object.material) {
      const isOpenShell = isOpenedShell(nodeId);
      const hovered = nodeId === state.hoveredId;
      const selected = nodeId === state.selectedId;
      const xrayShell = (selected || hovered || isOpenShell) && shouldShowMesh(nodeId);
      object.material.wireframe = xrayShell;
      const opacity = dim ? 0.24 : xrayShell ? Math.min(object.userData.defaultOpacity ?? 1, 0.36) : object.userData.defaultOpacity ?? 1;
      object.material.opacity = opacity;
      object.material.transparent = xrayShell || dim || Boolean(object.userData.defaultTransparent);
      object.material.depthWrite = xrayShell ? false : object.userData.defaultDepthWrite ?? true;
      if (xrayShell) {
        object.material.color.setHex(0x8fd8ff);
        object.material.emissive.setHex(0x63d2ff);
      } else if (node) {
        object.material.color.setHex(colorForNode(node));
        object.material.emissive.setHex(emissiveForNode(node));
      }
      object.material.needsUpdate = true;
      object.material.emissiveIntensity = nodeId === state.selectedId ? 0.45 : hovered ? 0.34 : matched ? 0.28 : node?.kind === "swiftui_view" ? 0.08 : 0.02;
    }
  });
  buildHoverXray(neighborhood);
  applyPopupHoverMaterials();
  applyPopupEdgeSelection();
  buildPopupHoverXray();

  edgeRoot.visible = state.showEdges;
  edgeRoot.children.forEach((edgeObject) => {
    const edge = edgeObject.userData.edge;
    const isSelectedEdge = edgeKey(edge) === state.selectedEdgeKey;
    const matchesSelection = !state.selectedEdgesOnly || isSelectedEdge || edge.from === state.selectedId || edge.to === state.selectedId;
    const visible = (!state.focusMode || neighborhood.has(edge.from) || neighborhood.has(edge.to))
      && isEdgeVisible(edge)
      && matchesSelection
      && state.visibleNodeIds.has(edge.from)
      && state.visibleNodeIds.has(edge.to);
    edgeObject.visible = visible;
    const touchesSelectedNode = edge.from === state.selectedId || edge.to === state.selectedId;
    const opacity = isSelectedEdge || touchesSelectedNode ? 1 : edgeOpacity(edge);
    edgeObject.userData.streetMaterial.color.setHex(isSelectedEdge ? 0x2f3c18 : 0x111a20);
    edgeObject.userData.streetMaterial.opacity = isSelectedEdge ? 0.92 : opacity * 0.48;
    edgeObject.userData.lineMaterial.color.setHex(isSelectedEdge ? 0xd7ff57 : edgeRenderColor(edge));
    edgeObject.userData.lineMaterial.opacity = isSelectedEdge ? 1 : Math.min(1, opacity * 1.08);
    edgeObject.userData.arrowMaterial.color.setHex(isSelectedEdge ? 0xd7ff57 : edgeRenderColor(edge));
    edgeObject.userData.arrowMaterial.opacity = isSelectedEdge ? 1 : opacity;
    edgeObject.scale.setScalar(1);
  });
}

function bindEvents() {
  window.addEventListener("resize", () => {
    resize();
    requestRender();
  });

  canvas.addEventListener("pointerdown", (event) => {
    state.pointerDown = { x: event.clientX, y: event.clientY };
    state.dragDistance = 0;
    requestRender();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (state.pointerDown) {
      const deltaX = event.clientX - state.pointerDown.x;
      const deltaY = event.clientY - state.pointerDown.y;
      state.dragDistance = Math.max(state.dragDistance, Math.hypot(deltaX, deltaY));
      if (state.dragDistance > 6) {
        clearHover();
        requestRender();
        return;
      }
    }
    updateHoverFromPointer(event);
  });

  canvas.addEventListener("pointerleave", () => {
    clearHover();
  });

  window.addEventListener("pointerup", () => {
    state.pointerDown = null;
    requestRender();
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "q", "e", "pageup", "pagedown", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) return;
    event.preventDefault();
    state.pressedKeys.add(key);
    requestRender();
  });

  window.addEventListener("keyup", (event) => {
    state.pressedKeys.delete(event.key.toLowerCase());
    requestRender();
  });

  canvas.addEventListener("click", (event) => {
    if (state.dragDistance > 6) {
      state.dragDistance = 0;
      return;
    }
    state.dragDistance = 0;
    const rect = canvas.getBoundingClientRect();
    state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(state.pointer, camera);
    const intersections = raycaster.intersectObjects([...root.children, ...popupRoot.children, ...edgeRoot.children], true);
    const selectedNodeId = pickNodeIdFromIntersections(intersections.filter(isPickableIntersection));
    if (selectedNodeId) {
      if (state.openShellId && selectedNodeId === state.openShellId) {
        hidePopup();
        return;
      }
      selectNode(selectedNodeId);
      return;
    }
    const selectedEdge = pickEdgeFromIntersections(intersections);
    if (selectedEdge) {
      selectEdge(selectedEdge);
      return;
    }
    if (state.openShellId) hidePopup();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      state.query = "";
      searchInput.value = "";
      markFiltersDirty();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    state.query = searchInput.value.trim();
    markFiltersDirty();
    const match = state.layout.find((node) => isSearchMatch(node));
    if (match) selectNode(match.id);
  });

  viewAllButton.addEventListener("click", () => {
    resetMapView();
  });

  focusButton.addEventListener("click", () => {
    state.focusMode = !state.focusMode;
    markFiltersDirty();
    syncButtons();
  });

  edgesButton.addEventListener("click", () => {
    state.showEdges = !state.showEdges;
    markFiltersDirty();
    syncButtons();
  });

  shareMapButton.addEventListener("click", async () => {
    await shareMapScreenshot();
  });

  toggleLeftRailButton.addEventListener("click", () => {
    appShell.classList.toggle("is-left-hidden");
    syncRailButtons();
    resize();
    requestRender();
  });

  toggleRightRailButton.addEventListener("click", () => {
    appShell.classList.toggle("is-right-hidden");
    syncRailButtons();
    resize();
    requestRender();
  });

  mapPresetButtons.forEach((button) => {
    button.addEventListener("click", () => applyMapPreset(button.dataset.viewPreset));
  });

  parserSelect.addEventListener("change", async () => {
    state.parserMode = ["xcode-index", "merged", "swiftsyntax", "heuristic"].includes(parserSelect.value) ? parserSelect.value : "merged";
    localStorage.setItem(parserModeKey, state.parserMode);
    const lastProjectPath = localStorage.getItem(lastProjectPathKey);
    if (!lastProjectPath) {
      pickerStatus.textContent = `Parser set to ${describeParser(state.parserMode)}.`;
      return;
    }

    try {
      await scanPath(lastProjectPath, `Reloaded with ${describeParser(state.parserMode)}`);
    } catch (error) {
      showStartupError(error);
    }
  });

  compareParsersButton.addEventListener("click", async () => {
    try {
      await compareParsers();
    } catch (error) {
      parserDiff.innerHTML = `<p><strong>Compare error</strong><br><code>${escapeHtml(error.message)}</code></p>`;
    }
  });

  showFilesToggle.addEventListener("change", () => {
    state.showFiles = showFilesToggle.checked;
    markFiltersDirty();
  });

  showModulesToggle.addEventListener("change", () => {
    state.showModules = showModulesToggle.checked;
    markFiltersDirty();
  });

  showProtocolsToggle.addEventListener("change", () => {
    state.showProtocols = showProtocolsToggle.checked;
    buildMemberPopup();
    markFiltersDirty();
  });

  showPropertiesToggle.addEventListener("change", () => {
    state.showProperties = showPropertiesToggle.checked;
    buildMemberPopup();
    markFiltersDirty();
  });

  selectedEdgesOnlyToggle.addEventListener("change", () => {
    state.selectedEdgesOnly = selectedEdgesOnlyToggle.checked;
    markFiltersDirty();
  });

  performanceModeToggle.addEventListener("change", () => {
    state.performanceMode = performanceModeToggle.checked;
    renderer.setPixelRatio(state.performanceMode ? 1 : Math.min(window.devicePixelRatio, 2));
    buildScene();
    buildMemberPopup();
    markFiltersDirty();
  });

  edgeDensitySelect.addEventListener("change", () => {
    state.edgeDensity = edgeDensitySelect.value;
    buildScene();
    buildMemberPopup();
    markFiltersDirty();
  });

  bindEdgeFilter(edgeUsesToggle, "uses");
  bindEdgeFilter(edgeImportsToggle, "imports");
  bindEdgeFilter(edgeConformsToggle, "conforms_to");
  bindEdgeFilter(edgeDefinesToggle, "defines");
  bindEdgeFilter(edgeStateToggle, "owns_state");
  bindEdgeFilter(edgeMembersToggle, "uses_member");
  bindEdgeFilter(edgeInferredToggle, "inferred");
  bindEdgeFilter(edgeIndexToggle, "xcode-index");

  selectedDetails.addEventListener("click", async (event) => {
    const sourceButton = event.target.closest("[data-source-node-id]");
    if (sourceButton) {
      const node = state.nodeById.get(sourceButton.dataset.sourceNodeId);
      if (!node) return;
      await showSourcePreview(node);
      return;
    }

    const contextButton = event.target.closest("[data-source-context]");
    if (contextButton) {
      const node = state.nodeById.get(contextButton.dataset.sourceContext);
      if (!node) return;
      state.sourceContext = clamp(state.sourceContext + Number(contextButton.dataset.delta || 0), 4, 80);
      await showSourcePreview(node);
      return;
    }

    const xcodeButton = event.target.closest("[data-xcode-node-id]");
    if (xcodeButton) {
      const node = state.nodeById.get(xcodeButton.dataset.xcodeNodeId);
      if (!node) return;
      await openSourceInXcode(node);
    }
  });

  parserDiff.addEventListener("click", async (event) => {
    const sourceButton = event.target.closest("[data-diff-source]");
    if (!sourceButton || !state.parserComparison) return;
    const node = findComparisonNode(sourceButton.dataset.diffSource);
    const preview = sourceButton.closest(".diff-item")?.querySelector(".diff-source-preview");
    if (!node || !preview) return;
    await showDiffSourcePreview(node, preview);
  });

  pickProjectButton.addEventListener("click", async () => {
    try {
      await pickAndScanProject();
    } catch (error) {
      showStartupError(error);
    }
  });

  loadSampleButton.addEventListener("click", async () => {
    try {
      await loadSampleUniverse();
    } catch (error) {
      showStartupError(error);
    }
  });
}

function bindEdgeFilter(toggle, kind) {
  toggle.addEventListener("change", () => {
    state.edgeFilters[kind] = toggle.checked;
    buildScene();
    buildMemberPopup();
    markFiltersDirty();
  });
}

function describeParser(mode) {
  if (mode === "xcode-index") return "Xcode Index map";
  if (mode === "merged") return "best combined view";
  return mode === "swiftsyntax" ? "accurate Swift parse" : "fast overview";
}

function formatScanSummary(diagnostics) {
  const parts = [
    `${diagnostics.swiftFileCount} Swift files`,
    `${diagnostics.typeCount} types`
  ];
  if (diagnostics.focusedFile) {
    parts.unshift(`Focused file: ${diagnostics.focusedFile}`);
  }
  if (diagnostics.heuristicHintEdges !== undefined) {
    parts.push(`${diagnostics.heuristicHintEdges} inferred hint edges`);
  }
  if (diagnostics.swiftSyntaxMessage) {
    parts.push(diagnostics.swiftSyntaxMessage);
  }
  if (diagnostics.xcodeIndexEdges !== undefined) {
    parts.push(`${diagnostics.xcodeIndexEdges} Xcode index edges`);
  }
  if (diagnostics.xcodeIndexMessage) {
    parts.push(diagnostics.xcodeIndexMessage);
  }
  parts.push(`source root ${diagnostics.sourceRoot}`);
  return parts.join(" · ");
}

function renderParserComparison(comparison) {
  const heuristicOnly = comparison.nodes.onlyHeuristic;
  const swiftSyntaxOnly = comparison.nodes.onlySwiftSyntax;
  const mergedOnly = comparison.nodes.onlyMerged || [];
  const xcodeIndexOnly = comparison.nodes.onlyXcodeIndex || [];
  const xcodeOnlyEdges = comparison.edges.xcodeIndexOnlyDetails || [];
  const indexDiagnostics = comparison.xcodeIndexDiagnostics || {};

  return `
    <div class="diff-summary">
      <div><span>Heuristic</span><strong>${comparison.heuristic.nodeCount}</strong></div>
      <div><span>SwiftSyntax</span><strong>${comparison.swiftsyntax.nodeCount}</strong></div>
      <div><span>Merged</span><strong>${comparison.merged.nodeCount}</strong></div>
      <div><span>Xcode</span><strong>${comparison.xcodeIndex.nodeCount}</strong></div>
    </div>
    <p class="diff-compact-line">${comparison.nodes.shared} shared symbols · ${comparison.edges.shared} shared edges · ${comparison.edges.mergedOnly || 0} merged-only · ${comparison.edges.xcodeIndexOnly || 0} index-only</p>
    <details class="diff-group diff-meta">
      <summary>Xcode index status</summary>
      ${indexDiagnostics.xcodeIndexAvailable
        ? `<p><code>${escapeHtml(indexDiagnostics.xcodeIndexStore || "")}</code></p>`
        : `<p>${escapeHtml(indexDiagnostics.xcodeIndexMessage || "No Xcode index details available.")}</p>`}
    </details>
    ${renderKindDelta("Fast heuristic only", heuristicOnly, comparison.nodes.onlyHeuristicByKind, "heuristic")}
    ${renderKindDelta("SwiftSyntax only", swiftSyntaxOnly, comparison.nodes.onlySwiftSyntaxByKind, "swiftsyntax")}
    ${renderKindDelta("Merged layered only", mergedOnly, comparison.nodes.onlyMergedByKind || {}, "merged")}
    ${renderKindDelta("Xcode Index nodes only", xcodeIndexOnly, comparison.nodes.onlyXcodeIndexByKind || {}, "xcode-index")}
    ${renderEdgeDelta("Xcode Index edges only", xcodeOnlyEdges)}
  `;
}

function renderKindDelta(title, nodes, byKind, parserName) {
  const kindSummary = Object.entries(byKind)
    .sort(([leftKind], [rightKind]) => leftKind.localeCompare(rightKind))
    .map(([kind, count]) => `<span><code>${escapeHtml(kind)}</code> ${count}</span>`)
    .join("");
  const items = nodes.slice(0, 40).map((node) => renderDiffNode(node, parserName)).join("");
  const truncated = nodes.length > 40 ? `<p class="status-copy">Showing first 40 of ${nodes.length} parser-only symbols.</p>` : "";

  return `
    <details class="diff-group">
      <summary>${escapeHtml(title)} <span>${nodes.length}</span></summary>
      <div class="diff-kinds">${kindSummary || "<span>No parser-only symbols.</span>"}</div>
      <div class="diff-list">${items || "<p>No differences in this direction.</p>"}</div>
      ${truncated}
    </details>
  `;
}

function renderDiffNode(node, parserName) {
  const sourceKey = `${parserName}:${node.id}`;
  const location = node.file ? `${node.file}:${node.line}` : "no source location";
  return `
    <article class="diff-item">
      <div>
        <strong>${escapeHtml(node.name)}</strong>
        <span><code>${escapeHtml(node.kind)}</code> ${escapeHtml(location)}</span>
      </div>
      ${node.file ? `<button class="button button-compact" type="button" data-diff-source="${escapeHtml(sourceKey)}">Source</button>` : ""}
      <div class="diff-source-preview source-preview"></div>
    </article>
  `;
}

function renderEdgeDelta(title, edges) {
  const items = edges.slice(0, 40).map((edge) => `
    <article class="diff-item">
      <div>
        <strong>${escapeHtml(edge.fromName)} → ${escapeHtml(edge.toName)}</strong>
        <span><code>${escapeHtml(edge.kind)}</code> ${edge.source ? `from <code>${escapeHtml(edge.source)}</code>` : ""}${edge.evidence ? ` · evidence <code>${escapeHtml(edge.evidence)}</code>` : ""}${edge.confidence ? ` · confidence <code>${escapeHtml(edge.confidence)}</code>` : ""}</span>
      </div>
    </article>
  `).join("");
  const truncated = edges.length > 40 ? `<p class="status-copy">Showing first 40 of ${edges.length} index-only edges.</p>` : "";

  return `
    <details class="diff-group">
      <summary>${escapeHtml(title)} <span>${edges.length}</span></summary>
      <div class="diff-list">${items || "<p>No index-only edges.</p>"}</div>
      ${truncated}
    </details>
  `;
}

function findComparisonNode(sourceKey) {
  const [parserName, ...idParts] = sourceKey.split(":");
  const id = idParts.join(":");
  const nodesByParser = {
    heuristic: state.parserComparison.nodes.onlyHeuristic,
    swiftsyntax: state.parserComparison.nodes.onlySwiftSyntax,
    merged: state.parserComparison.nodes.onlyMerged || [],
    "xcode-index": state.parserComparison.nodes.onlyXcodeIndex || []
  };
  const nodes = nodesByParser[parserName] || [];
  return nodes.find((node) => node.id === id);
}

async function showDiffSourcePreview(node, preview) {
  preview.innerHTML = "<p>Loading source...</p>";
  try {
    const response = await fetch("/api/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceRoot: state.parserComparison.project.sourceRoot,
        file: node.file,
        line: node.line
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Source preview failed.");
    }
    preview.innerHTML = renderSourceSnippet(payload);
  } catch (error) {
    preview.innerHTML = `<p><strong>Source error</strong><br><code>${escapeHtml(error.message)}</code></p>`;
  }
}

function formatSigned(value) {
  return value > 0 ? `+${value}` : String(value);
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  controls.update();
}

function updateNavigationBounds() {
  const radius = computeLayoutRadius();
  state.mapRadius = radius;
  controls.maxDistance = Math.max(6000, radius * 2.8);
  camera.far = Math.max(12000, controls.maxDistance * 2.2);
  scene.fog.near = Math.max(2600, radius * 0.9);
  scene.fog.far = Math.max(6200, controls.maxDistance * 1.65);
  camera.updateProjectionMatrix();
}

function computeLayoutRadius() {
  if (state.layout.length === 0) return 900;
  return state.layout.reduce((radius, node) => {
    const distance = Math.hypot(node.x || 0, node.z || 0);
    const footprint = Math.max(node.width || 0, node.depth || 0);
    return Math.max(radius, distance + footprint);
  }, 520);
}

function homeCameraPosition() {
  const radius = state.mapRadius || 900;
  return new THREE.Vector3(
    0,
    Math.max(defaultCameraPosition.y, radius * 0.55),
    Math.max(defaultCameraPosition.z, radius * 0.95)
  );
}

function applyKeyboardNavigation() {
  if (state.pressedKeys.size === 0) return;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const movement = new THREE.Vector3();

  if (state.pressedKeys.has("w") || state.pressedKeys.has("arrowup")) movement.add(forward);
  if (state.pressedKeys.has("s") || state.pressedKeys.has("arrowdown")) movement.sub(forward);
  if (state.pressedKeys.has("d") || state.pressedKeys.has("arrowright")) movement.add(right);
  if (state.pressedKeys.has("a") || state.pressedKeys.has("arrowleft")) movement.sub(right);
  if (state.pressedKeys.has("e") || state.pressedKeys.has("pageup")) movement.y += 1;
  if (state.pressedKeys.has("q") || state.pressedKeys.has("pagedown")) movement.y -= 1;
  if (movement.lengthSq() === 0) return;

  const distance = camera.position.distanceTo(controls.target);
  const speed = Math.max(4, distance * 0.018);
  state.cameraAnimation = null;
  movement.normalize().multiplyScalar(speed);
  camera.position.add(movement);
  controls.target.add(movement);
}

function resetMapView() {
  state.focusMode = false;
  state.selectedId = null;
  state.selectedEdgeKey = null;
  state.openShellId = null;
  state.query = "";
  state.hoveredId = null;
  state.pressedKeys.clear();
  searchInput.value = "";
  clearHover();
  disposeGroupMaterials(popupRoot);
  popupRoot.clear();
  state.cameraAnimation = null;
  state.popupFocusTarget = null;
  camera.position.copy(homeCameraPosition());
  controls.target.copy(defaultControlsTarget);
  controls.update();
  selectedDetails.innerHTML = `<p>Click any object in the map to inspect what it is, what it uses, and where it lives in source.</p>`;
  markFiltersDirty();
  syncButtons();
}

function updateHoverFromPointer(event) {
  if (!state.graph || state.dragDistance > 6) return;
  const rect = canvas.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(state.pointer, camera);
  const intersections = raycaster.intersectObjects([...root.children, ...popupRoot.children, ...edgeRoot.children], true);
  const hoveredId = pickNodeIdFromIntersections(intersections.filter(isPickableIntersection));
  const hoveredEdge = pickEdgeFromIntersections(intersections);
  if (state.hoveredId !== hoveredId) {
    state.hoveredId = hoveredId;
    markFiltersDirty();
  }
  canvas.style.cursor = hoveredId || hoveredEdge ? "pointer" : "grab";

  if (!hoveredId) {
    clearHover();
    return;
  }

  const node = state.nodeById.get(hoveredId);
  if (!node) {
    clearHover();
    return;
  }

  hoverTooltip.hidden = false;
  hoverTooltip.style.left = `${event.clientX - rect.left + 18}px`;
  hoverTooltip.style.top = `${event.clientY - rect.top + 18}px`;
  hoverTooltip.innerHTML = renderHoverTooltip(node);
}

function renderHoverTooltip(node) {
  const metrics = node.metrics || {};
  const ownLines = Math.max(1, metrics.lines || 1);
  const ownVars = Math.max(0, metrics.properties || (node.kind === "property" ? 1 : 0));
  const ownFuncs = Math.max(0, metrics.methods || (node.kind === "function" ? 1 : 0));
  const ownComplexity = complexityForNode(node);
  const title = escapeHtml(node.name);
  const location = node.file ? `${escapeHtml(node.file)}:${node.line}` : friendlyKind(node.kind);
  const kind = escapeHtml(friendlyKind(node.kind));
  const details = [];

  if (node.kind === "file") {
    details.push(`${formatNumber(ownLines)} LOC`);
    details.push(`file plot`);
  } else if (node.kind === "function") {
    details.push(`${formatNumber(ownLines)} LOC · ${formatNumber(metrics.branches || 0)} branches`);
    details.push(`${formatNumber(metrics.calls || 0)} calls · complexity ${formatNumber(ownComplexity)}`);
  } else if (node.kind === "property") {
    details.push(`state/property sphere`);
    details.push(`complexity ${formatNumber(ownComplexity)}`);
  } else {
    details.push(`${formatNumber(ownLines)} LOC · ${formatNumber(ownVars)} vars · ${formatNumber(ownFuncs)} funcs`);
    details.push(`complexity ${formatNumber(ownComplexity)}`);
  }

  return `
    <strong>${title}</strong>
    <span>${kind} · ${location}</span>
    ${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}
  `;
}

function clearHover() {
  const hadHover = Boolean(state.hoveredId);
  state.hoveredId = null;
  canvas.style.cursor = "grab";
  hoverTooltip.hidden = true;
  if (hadHover) markFiltersDirty();
}

function applyMapPreset(preset) {
  state.focusMode = false;
  state.showEdges = true;
  state.selectedEdgesOnly = false;
  selectedEdgesOnlyToggle.checked = false;

  if (preset === "files") {
    state.showFiles = true;
    state.showModules = false;
    state.showProtocols = true;
    state.showProperties = false;
    state.edgeDensity = "clean";
  } else if (preset === "architecture") {
    state.showFiles = true;
    state.showModules = true;
    state.showProtocols = true;
    state.showProperties = true;
    state.edgeDensity = "normal";
  } else if (preset === "quiet") {
    state.showEdges = false;
    state.edgeDensity = "clean";
  } else {
    state.showFiles = true;
    state.showModules = true;
    state.showProtocols = true;
    state.showProperties = true;
    state.edgeDensity = "normal";
  }

  showFilesToggle.checked = state.showFiles;
  showModulesToggle.checked = state.showModules;
  showProtocolsToggle.checked = state.showProtocols;
  showPropertiesToggle.checked = state.showProperties;
  edgeDensitySelect.value = state.edgeDensity;
  mapPresetButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewPreset === preset);
  });

  buildScene();
  buildMemberPopup();
  markFiltersDirty();
  syncButtons();
}

function focusCameraOnNode(node) {
  const layoutNode = state.layoutById.get(node?.id);
  if (!layoutNode || layoutNode.kind === "repository") return;
  const focusTarget = state.popupFocusTarget?.nodeId === node.id ? state.popupFocusTarget : null;
  const target = focusTarget
    ? focusTarget.target.clone()
    : new THREE.Vector3(layoutNode.x, (layoutNode.y || 0) + layoutNode.height * 0.8, layoutNode.z);
  const currentDirection = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  if (currentDirection.lengthSq() === 0) currentDirection.set(0.35, 0.55, 0.75).normalize();
  const distance = focusTarget
    ? focusTarget.distance
    : clamp(Math.max(layoutNode.width, layoutNode.height, layoutNode.depth) * 8, 260, 760);
  const position = target.clone().add(currentDirection.multiplyScalar(distance));
  state.cameraAnimation = {
    startPosition: camera.position.clone(),
    startTarget: controls.target.clone(),
    endPosition: position,
    endTarget: target,
    startedAt: performance.now(),
    duration: 650
  };
}

function applyCameraAnimation() {
  if (!state.cameraAnimation) return;
  const elapsed = performance.now() - state.cameraAnimation.startedAt;
  const progress = clamp(elapsed / state.cameraAnimation.duration, 0, 1);
  const eased = 1 - Math.pow(1 - progress, 3);
  camera.position.lerpVectors(state.cameraAnimation.startPosition, state.cameraAnimation.endPosition, eased);
  controls.target.lerpVectors(state.cameraAnimation.startTarget, state.cameraAnimation.endTarget, eased);
  if (progress >= 1) state.cameraAnimation = null;
}

function selectNode(id) {
  state.selectedId = id;
  state.selectedEdgeKey = null;
  const node = state.nodeById.get(id);
  if (!node) return;
  state.openShellId = resolveOpenShellId(id);
  selectedDetails.innerHTML = renderDetails(node);
  buildMemberPopup();
  markFiltersDirty();
  focusCameraOnNode(node);
  if (node.file) {
    showSourcePreview(node);
  }
}

function selectEdge(edge) {
  state.selectedEdgeKey = edgeKey(edge);
  state.selectedId = null;
  disposeGroupMaterials(popupXrayRoot);
  popupXrayRoot.clear();
  selectedDetails.innerHTML = renderEdgeDetails(edge);
  markFiltersDirty();
}

function hidePopup() {
  state.openShellId = null;
  state.popupFocusTarget = null;
  disposeGroupMaterials(popupRoot);
  disposeGroupMaterials(popupXrayRoot);
  popupRoot.clear();
  popupXrayRoot.clear();
  markFiltersDirty();
}

function renderDetails(node) {
  const outgoing = state.edgesByFrom.get(node.id) || [];
  const incoming = state.edgesByTo.get(node.id) || [];
  const kindMeaning = describeKind(node.kind);
  const memberIds = getInspectableMemberIds(node.id);
  const popupContentIds = getPopupContentIds(node.id);
  const externalUses = getExternalUses(node);
  const ownedState = getOwnedState(node);
  const axis = axisMetricsForNode(node);
  const dimensions = dimensionsForNode(node);
  const complexity = complexityForNode(node);
  const axisDetails = describeAxisDrivers(node);
  const names = (edges, direction) => edges
    .slice(0, 6)
    .map((edge) => {
      const otherId = direction === "out" ? edge.to : edge.from;
      const other = state.nodeById.get(otherId);
      return `<code>${edge.kind}</code> ${escapeHtml(other?.name || otherId)}`;
    })
    .join("<br>");

  return `
    <div class="detail-card object-summary-card">
      <div class="detail-title">
        <div class="object-title-lockup">
          <span class="object-icon" aria-hidden="true"></span>
          <div>
            <h3>${escapeHtml(node.name)}</h3>
            <p>${escapeHtml(kindMeaning)}</p>
          </div>
        </div>
        <span class="detail-badge">${escapeHtml(friendlyKind(node.kind))}</span>
      </div>
      <div class="summary-table">
        <div><span>Complexity</span><strong>${formatNumber(complexity)}</strong></div>
        <div><span>LOC</span><strong>${formatNumber(axis.lines)}</strong></div>
        <div><span>Vars</span><strong>${formatNumber(axis.variables)}</strong></div>
        <div><span>Funcs</span><strong>${formatNumber(axis.functions)}</strong></div>
        <div><span>Size</span><strong>${dimensions.width}×${dimensions.height}×${dimensions.depth}</strong></div>
        ${node.file ? `<div><span>File</span><strong>${escapeHtml(node.file)}:${node.line}</strong></div>` : ""}
      </div>
    </div>
    ${node.source ? `<p>Found by <code>${escapeHtml(node.source)}</code>${node.inferred ? " · inferred hint" : ""}${node.indexResolved ? " · Xcode index resolved" : ""}${node.confidence ? ` · confidence <code>${escapeHtml(node.confidence)}</code>` : ""}</p>` : ""}
    ${node.file ? `<section class="source-card"><div class="source-card-header"><div><span class="eyebrow">Source view</span><strong>${escapeHtml(node.file)}:${node.line}</strong></div><div class="source-control-group"><button class="button button-compact source-button-primary" type="button" data-source-node-id="${escapeHtml(node.id)}">View source</button><button class="button button-compact" type="button" data-source-context="${escapeHtml(node.id)}" data-delta="-6">− Context</button><button class="button button-compact" type="button" data-source-context="${escapeHtml(node.id)}" data-delta="6">+ Context</button><button class="button button-compact" type="button" data-xcode-node-id="${escapeHtml(node.id)}">Open in Xcode</button></div></div><div id="sourcePreview" class="source-preview"><p>Loading source...</p></div></section>` : ""}
    <div class="detail-grid">
      <p><strong>Axis mapping</strong><br>${axisDetails}</p>
      <p><strong>Inside this object</strong><br>${popupContentIds.length > 0 ? `${popupContentIds.length} contained objects in the 3D popup.` : "No inspectable members yet."}</p>
      ${ownedState.length > 0 ? `<p><strong>State it owns</strong><br>${names(ownedState, "out")}</p>` : ""}
      ${node.kind === "function" ? `<p><strong>Uses outside parent</strong><br>${names(externalUses, "out") || "No external type usage detected."}</p>` : ""}
      <p><strong>Uses</strong><br>${names(outgoing.filter((edge) => edge.kind !== "owns_state"), "out") || "No outgoing relationships yet."}</p>
      <p><strong>Used by</strong><br>${names(incoming, "in") || "No incoming relationships yet."}</p>
    </div>
  `;
}

function renderEdgeDetails(edge) {
  const from = state.nodeById.get(edge.from);
  const to = state.nodeById.get(edge.to);
  return `
    <div class="detail-card object-summary-card">
      <div class="detail-title">
        <div class="object-title-lockup">
          <span class="object-icon" aria-hidden="true"></span>
          <div>
            <h3>${escapeHtml(edge.kind.replaceAll("_", " "))}</h3>
            <p>Selected connection</p>
          </div>
        </div>
        <span class="detail-badge">Edge</span>
      </div>
      <div class="summary-table">
        <div><span>From</span><strong>${escapeHtml(from?.name || edge.from)}</strong></div>
        <div><span>To</span><strong>${escapeHtml(to?.name || edge.to)}</strong></div>
        <div><span>Type</span><strong>${escapeHtml(edge.kind)}</strong></div>
        ${edge.source ? `<div><span>Source</span><strong>${escapeHtml(edge.source)}</strong></div>` : ""}
        ${edge.evidence ? `<div><span>Evidence</span><strong>${escapeHtml(edge.evidence)}</strong></div>` : ""}
        ${edge.inferred ? "<div><span>Confidence</span><strong>Inferred</strong></div>" : ""}
      </div>
    </div>
    <div class="detail-grid">
      <p><strong>Meaning</strong><br>${escapeHtml(describeEdge(edge))}</p>
      <p><strong>Action</strong><br>Use “Useful only” to keep this selected connection visible, or click an object at either end to inspect its source.</p>
    </div>
  `;
}

function describeEdge(edge) {
  if (edge.source === "xcode-index" && edge.evidence === "file-level") {
    return "Xcode index evidence found both symbols in the same indexed file record; treat this as a file-level semantic hint.";
  }
  if (edge.kind === "uses") return "The source object references or calls the target object.";
  if (edge.kind === "imports") return "The source file imports the target framework or module.";
  if (edge.kind === "defines") return "The source file contains or defines the target object.";
  if (edge.kind === "owns_state") return "The source type owns or exposes this state/property.";
  if (edge.kind === "uses_member") return "A member inside the popup references another member or dependency.";
  if (edge.kind === "conforms_to") return "The source type conforms to the target protocol.";
  return "A detected relationship between two code objects.";
}

async function openSourceInXcode(node) {
  const preview = document.querySelector("#sourcePreview");
  if (preview) preview.innerHTML = "<p>Opening in Xcode...</p>";
  try {
    const response = await fetch("/api/open-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceRoot: state.graph.project.sourceRoot,
        file: node.file,
        line: node.line,
        context: state.sourceContext
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Xcode open failed.");
    }
    if (preview) preview.innerHTML = `<p>Opened <code>${escapeHtml(payload.file)}:${payload.line}</code> in Xcode.</p>`;
  } catch (error) {
    if (preview) preview.innerHTML = `<p><strong>Xcode error</strong><br><code>${escapeHtml(error.message)}</code></p>`;
  }
}

async function showSourcePreview(node) {
  const preview = document.querySelector("#sourcePreview");
  if (!preview) return;

  preview.innerHTML = "<p>Loading source...</p>";
  try {
    const response = await fetch("/api/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceRoot: state.graph.project.sourceRoot,
        file: node.file,
        line: node.line,
        context: state.sourceContext
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Source preview failed.");
    }
    preview.innerHTML = renderSourceSnippet(payload);
  } catch (error) {
    preview.innerHTML = `<p><strong>Source error</strong><br><code>${escapeHtml(error.message)}</code></p>`;
  }
}

function renderSourceSnippet(payload) {
  const rows = payload.code.map((line) => {
    const isTarget = line.number === payload.line;
    return `<span class="${isTarget ? "is-target" : ""}"><b>${line.number}</b><code>${escapeHtml(line.content || " ")}</code></span>`;
  }).join("");

  return `
    <p><strong>${escapeHtml(payload.file)}:${payload.line}</strong></p>
    <pre>${rows}</pre>
  `;
}

function getExternalUses(node) {
  if (node.kind !== "function") return [];
  const parentId = (state.edgesByTo.get(node.id) || []).find((edge) => edge.kind === "defines")?.from;
  return (state.edgesByFrom.get(node.id) || []).filter((edge) => edge.kind === "uses" && edge.to !== parentId);
}

function getOwnedState(node) {
  return (state.edgesByFrom.get(node.id) || []).filter((edge) => edge.kind === "owns_state");
}

function describeAxisDrivers(node) {
  const dimensions = dimensionsForNode(node);
  const volume = dimensions.width * dimensions.height * dimensions.depth;
  const axis = axisMetricsForNode(node);
  const city = cityMetricsForNode(node);
  const edgeCounts = graphEdgeCountsForNode(node.id);
  const tint = complexityTintForNode(node);
  const axisDescription = node.kind === "file"
    ? [
        `district plot: outer plane contains this file’s structs, views, models, and services`,
        `inner LOC inlay = lines of code <code>${formatNumber(axis.lines)}</code>`,
        `Y height = fixed thin floor`,
        `complexity tint = file activity around the district`
      ]
    : node.kind === "property"
      ? [
          `city object: state sphere`,
          `diameter = state weight + complexity`,
          `inputs: LOC <code>${formatNumber(city.loc)}</code>, vars <code>${formatNumber(city.vars)}</code>, funcs <code>${formatNumber(city.funcs)}</code>`
        ]
      : node.kind === "function"
        ? [
            `city object: utility tower`,
            `Y height = LOC × complexity boost <code>${formatNumber(city.heightScore)}</code>`,
            `X/Z footprint = calls + branches <code>${formatNumber(axis.functions)}</code>`
          ]
      : [
          `city object: building mass`,
          `X width = vars/properties <code>${formatNumber(axis.variables)}</code> + LOC share`,
          `Z depth = functions/methods <code>${formatNumber(axis.functions)}</code> + LOC share`,
          `Y height = LOC <code>${formatNumber(axis.lines)}</code> × complexity boost`
        ];
  const factors = [
    ...axisDescription,
    `formula mass = (LOC + vars×18 + funcs×22) × complexity boost <code>${formatNumber(city.volumeScore)}</code>`,
    `complexity boost <code>${formatNumber(city.complexityBoost)}</code> · tint <code>${formatNumber(tint * 100)}%</code>`,
    `size <code>${dimensions.width}×${dimensions.height}×${dimensions.depth}</code>`,
    `volume <code>${formatNumber(volume)}</code>`
  ];

  if (node.kind === "function") {
    factors.push(
      `uses <code>${edgeCounts.outgoingUses}</code> · member uses <code>${edgeCounts.memberUses}</code> · used by <code>${edgeCounts.incoming}</code>`
    );
  } else if (node.kind === "property") {
    factors.push(`used by <code>${edgeCounts.incoming}</code> · uses <code>${edgeCounts.outgoingUses}</code>`);
  } else if (node.kind === "module" || node.kind === "repository") {
    factors.push("fixed baseline object");
  } else {
    factors.push(
      `members <code>${edgeCounts.definedMembers}</code> · uses <code>${edgeCounts.outgoingUses}</code> · used by <code>${edgeCounts.incoming}</code>`
    );
  }

  return factors.join("<br>");
}

function normalizedComplexityForNode(node, complexity = complexityForNode(node)) {
  const peers = (state.graph?.nodes || []).filter((candidate) => candidate.kind === node.kind);
  if (peers.length <= 1) {
    return { percentile: 100, label: "only object", kindLabel: friendlyKind(node.kind).toLowerCase() };
  }

  const peerScores = peers.map((candidate) => complexityForNode(candidate)).sort((left, right) => left - right);
  const lowerOrEqual = peerScores.filter((score) => score <= complexity).length;
  const percentile = Math.round((lowerOrEqual / peerScores.length) * 100);
  const label = percentile >= 85 ? "hotspot" : percentile >= 60 ? "above average" : percentile >= 35 ? "typical" : "small";
  return {
    percentile,
    label,
    kindLabel: `${friendlyKind(node.kind).toLowerCase()} objects`
  };
}

function formatNumber(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function focusedNeighborhood() {
  if (!state.graph || (!state.selectedId && !state.selectedEdgeKey)) {
    return new Set();
  }
  const selectedEdge = state.graph.edges.find((edge) => edgeKey(edge) === state.selectedEdgeKey);
  const neighborhood = new Set([state.selectedId, selectedEdge?.from, selectedEdge?.to].filter(Boolean));
  if (state.openShellId) {
    neighborhood.add(state.openShellId);
    getInspectableMemberIds(state.openShellId).forEach((memberId) => neighborhood.add(memberId));
  }
  (state.edgesByFrom.get(state.selectedId) || []).forEach((edge) => neighborhood.add(edge.to));
  (state.edgesByTo.get(state.selectedId) || []).forEach((edge) => neighborhood.add(edge.from));
  return neighborhood;
}

function isNodeVisible(node, neighborhood) {
  if (!node) return false;
  if (!state.showFiles && node.kind === "file") return false;
  if (!state.showModules && node.kind === "module") return false;
  if (!state.showProtocols && node.kind === "protocol") return false;
  return !state.focusMode || neighborhood.has(node.id) || node.kind === "repository";
}

function isEdgeVisible(edge) {
  if (!passesEdgeDensity(edge)) return false;
  if (edge.inferred && !state.edgeFilters.inferred) return false;
  if (edge.source === "xcode-index" && !state.edgeFilters["xcode-index"]) return false;
  return isEdgeKindEnabled(edge.kind);
}

function isMainEdgeRenderable(edge) {
  if (state.edgeDensity === "everything") {
    return ["uses", "imports", "conforms_to", "defines", "owns_state", "uses_member"].includes(edge.kind);
  }
  return ["uses", "imports", "conforms_to"].includes(edge.kind);
}

function passesEdgeDensity(edge) {
  if (state.edgeDensity === "everything") return true;
  if (state.edgeDensity === "clean") {
    if (edge.source === "xcode-index") return true;
    if (edge.kind === "conforms_to" && !edge.inferred) return true;
    if (state.selectedId && (edge.from === state.selectedId || edge.to === state.selectedId)) {
      return !edge.inferred && edge.kind !== "imports";
    }
    return false;
  }
  return !edge.inferred || state.edgeFilters.inferred;
}

function updateStats(graph, descriptor) {
  projectName.textContent = graph.project.name;
  const mode = state.largeGraphMode ? " · performance map" : "";
  const worker = state.layoutPreparedInWorker ? " · worker layout" : "";
  projectMeta.textContent = `${descriptor} · ${new Date(graph.project.scannedAt).toLocaleString()} · ${graph.nodes.length} items${mode}${worker}`;
  document.querySelector("#nodeCount").textContent = graph.nodes.length;
  document.querySelector("#edgeCount").textContent = graph.edges.length;
  document.querySelector("#viewCount").textContent = graph.nodes.filter((node) => node.kind === "swiftui_view").length;
  document.querySelector("#serviceCount").textContent = graph.nodes.filter((node) => node.kind === "service" || node.kind === "class").length;
}

function appendGraphScaleNotice() {
  if (!state.edgeRenderLimitHit && !state.largeGraphMode) return;
  const parts = [];
  if (state.largeGraphMode) parts.push("Large graph performance mode is active.");
  if (state.edgeRenderLimitHit) parts.push("Some edges are hidden by the current render budget; use Focus or cleaner filters for detail.");
  if (!parts.length) return;
  scanSummary.textContent = `${scanSummary.textContent} · ${parts.join(" ")}`;
}

function syncButtons() {
  focusButton.classList.toggle("is-active", state.focusMode);
  edgesButton.classList.toggle("is-active", state.showEdges);
  viewAllButton.classList.toggle("is-active", !state.focusMode);
  syncRailButtons();
  if (!state.showEdges) {
    mapPresetButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.viewPreset === "quiet"));
  }
}

function syncRailButtons() {
  const leftVisible = !appShell.classList.contains("is-left-hidden");
  const rightVisible = !appShell.classList.contains("is-right-hidden");
  toggleLeftRailButton.classList.toggle("is-active", leftVisible);
  toggleRightRailButton.classList.toggle("is-active", rightVisible);
  toggleLeftRailButton.setAttribute("aria-pressed", String(leftVisible));
  toggleRightRailButton.setAttribute("aria-pressed", String(rightVisible));
}

async function shareMapScreenshot() {
  draw();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
  if (!blob) {
    pickerStatus.textContent = "Screenshot could not be created.";
    return;
  }

  const fileName = `${safeFileName(state.graph?.project?.name || "code-universe")}-map.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: "Code Universe map",
      text: state.graph?.project?.name ? `Code Universe map for ${state.graph.project.name}` : "Code Universe map",
      files: [file]
    });
    pickerStatus.textContent = "Map screenshot shared.";
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  pickerStatus.textContent = `Downloaded ${fileName}.`;
}

function safeFileName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "code-universe";
}

function makeLabel(text, color, width = 92, height = 18) {
  const labelCanvas = document.createElement("canvas");
  const labelContext = labelCanvas.getContext("2d");
  labelCanvas.width = 320;
  labelCanvas.height = 64;
  labelContext.font = "700 23px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  labelContext.textAlign = "center";
  labelContext.textBaseline = "middle";
  labelContext.fillStyle = "rgba(5, 10, 14, 0.68)";
  labelContext.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
  labelContext.fillStyle = color;
  labelContext.fillText(text, labelCanvas.width / 2, labelCanvas.height / 2);
  const texture = new THREE.CanvasTexture(labelCanvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  return sprite;
}

function makeFileMarker(node) {
  const marker = new THREE.Group();
  const width = clamp(node.locWidth || node.width || 54, 18, Math.max(18, (node.width || 54) * 0.92));
  const depth = clamp(node.locDepth || node.depth || 40, 14, Math.max(14, (node.depth || 40) * 0.92));
  const thickness = 0.9;
  const baseMaterial = getStandardMaterial("file-marker-base", {
    color: 0x9fb0ba,
    roughness: 0.5,
    metalness: 0.04,
    emissive: 0x1f3038,
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.72
  });
  const foldMaterial = getStandardMaterial("file-marker-fold", {
    color: 0x8fb8ca,
    roughness: 0.55,
    metalness: 0.04,
    transparent: true,
    opacity: 0.82
  });
  const lineMaterial = getStandardMaterial("file-marker-lines", {
    color: 0x20323c,
    roughness: 0.7,
    metalness: 0.02,
    transparent: true,
    opacity: 0.74
  });

  const plate = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, depth), baseMaterial);
  plate.position.y = thickness / 2;
  marker.add(plate);

  const fold = new THREE.Mesh(new THREE.BoxGeometry(width * 0.28, thickness + 0.2, depth * 0.28), foldMaterial);
  fold.position.set(width * 0.29, thickness + 0.08, -depth * 0.29);
  marker.add(fold);

  [-0.18, 0.08, 0.34].forEach((offset) => {
    const line = new THREE.Mesh(new THREE.BoxGeometry(width * 0.58, thickness + 0.35, 0.7), lineMaterial);
    line.position.set(-width * 0.04, thickness + 0.18, depth * offset);
    marker.add(line);
  });

  return marker;
}

function makeSearchHalo(node) {
  const radius = Math.max(18, Math.max(node.width || 24, node.depth || 24) * 0.62);
  const tube = Math.max(1.6, radius * 0.055);
  const key = `search-halo:${Math.round(radius)}:${Math.round(tube * 10)}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = new THREE.TorusGeometry(radius, tube, 8, 40);
    geometry.rotateX(Math.PI / 2);
    geometryCache.set(key, geometry);
  }
  const material = getBasicMaterial("search-halo", {
    color: 0xfff07a,
    transparent: true,
    opacity: 0.82,
    depthWrite: false
  });
  return new THREE.Mesh(geometry, material);
}

function gridPosition(index, total, spacingX, spacingZ, originX = 0, originZ = 0) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: originX + (column - (columns - 1) / 2) * spacingX,
    z: originZ + (row - (rows - 1) / 2) * spacingZ
  };
}

function childPositionOnFilePlane(index, total, fileNode, childNodes = []) {
  if (!fileNode) return gridPosition(index, total, 66, 58);
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const spacing = spacingForNodes(childNodes, 38, 36, fileChildGap);
  const districtWidth = fileNode.visualWidth || fileNode.width;
  const districtDepth = fileNode.visualDepth || fileNode.depth;
  const usableWidth = Math.max(districtWidth * 0.25, spacing.x * Math.max(1, columns - 1));
  const usableDepth = Math.max(districtDepth * 0.25, spacing.z * Math.max(1, rows - 1));
  return {
    x: (column - (columns - 1) / 2) * Math.max(spacing.x, usableWidth / Math.max(1, columns)),
    z: (row - (rows - 1) / 2) * Math.max(spacing.z, usableDepth / Math.max(1, rows))
  };
}

function spacingForNodes(nodes, minimumX, minimumZ, padding = 18) {
  const dimensions = nodes.map((node) => dimensionsForNode(node));
  const maxWidth = dimensions.reduce((value, item) => Math.max(value, item.width || 0), 0);
  const maxDepth = dimensions.reduce((value, item) => Math.max(value, item.depth || 0), 0);
  const sizePadding = Math.max(padding, Math.max(maxWidth, maxDepth) * 0.18);
  return {
    x: Math.max(minimumX, maxWidth + sizePadding),
    z: Math.max(minimumZ, maxDepth + sizePadding)
  };
}

function boundsForLayout(items) {
  if (items.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }
  return items.reduce((bounds, item) => {
    const halfWidth = (item.width || 0) / 2;
    const halfDepth = (item.depth || 0) / 2;
    return {
      minX: Math.min(bounds.minX, (item.x || 0) - halfWidth),
      maxX: Math.max(bounds.maxX, (item.x || 0) + halfWidth),
      minZ: Math.min(bounds.minZ, (item.z || 0) - halfDepth),
      maxZ: Math.max(bounds.maxZ, (item.z || 0) + halfDepth)
    };
  }, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function dimensionsForNode(node) {
  const base = baseDimensionsForKind(node.kind);
  if (node.kind === "repository" || node.kind === "module") return base;

  const city = cityMetricsForNode(node);
  if (node.kind === "file") {
    const footprint = clamp(44 + Math.sqrt(city.loc) * 8.5, 44, 420);
    return {
      width: Math.round(footprint),
      height: 3,
      depth: Math.round(Math.max(28, footprint * 0.7))
    };
  }

  if (node.kind === "property") {
    const diameter = clamp(10 + Math.sqrt(city.volumeScore) * 1.8, 10, 58);
    return {
      width: Math.round(diameter),
      height: Math.round(diameter),
      depth: Math.round(diameter)
    };
  }

  const width = clamp(base.width * 0.55 + city.widthScore * 4.2, base.width * 0.75, 170);
  const height = clamp(base.height * 0.55 + city.heightScore * 2.4, base.height * 0.85, 440);
  const depth = clamp(base.depth * 0.55 + city.depthScore * 4.2, base.depth * 0.75, 170);

  return {
    width: Math.round(width),
    height: Math.round(height),
    depth: Math.round(depth)
  };
}

function axisLengthForMetric(value, minimum) {
  return Math.max(minimum, Math.round(8 + Math.sqrt(Math.max(0, value)) * 14));
}

function cityMetricsForNode(node) {
  const axis = axisMetricsForNode(node);
  const complexity = complexityForNode(node);
  const normalizedComplexity = normalizedComplexityScore(complexity, node.kind);
  const loc = Math.max(1, axis.lines);
  const vars = Math.max(0, axis.variables);
  const funcs = Math.max(0, axis.functions);
  const complexityBoost = 1 + normalizedComplexity * 0.42;
  const footprintBoost = 1 + normalizedComplexity * 0.18;
  const volumeScore = (loc + vars * 18 + funcs * 22) * complexityBoost;

  return {
    loc,
    vars,
    funcs,
    complexity,
    complexityBoost,
    volumeScore,
    widthScore: (Math.pow(loc, 0.45) * 0.9 + Math.pow(vars + 1, 0.62) * 2.5 + Math.pow(funcs + 1, 0.42) * 1.2) * footprintBoost,
    heightScore: (Math.pow(loc, 0.72) * 0.9 + Math.log1p(vars + funcs) * 4) * complexityBoost,
    depthScore: (Math.pow(loc, 0.45) * 0.9 + Math.pow(funcs + 1, 0.62) * 2.5 + Math.pow(vars + 1, 0.42) * 1.2) * footprintBoost
  };
}

function normalizedComplexityScore(complexity, kind) {
  if (kind === "property") return clamp(complexity / 8, 0, 1);
  if (kind === "function") return clamp(complexity / 28, 0, 1);
  return clamp(complexity / 42, 0, 1);
}

function axisMetricsForNode(node) {
  const metrics = node.metrics || {};
  const edgeCounts = graphEdgeCountsForNode(node.id);
  const definedMembers = getInspectableMemberIds(node.id)
    .map((memberId) => state.nodeById.get(memberId))
    .filter(Boolean);
  const definedFunctions = definedMembers.filter((member) => member.kind === "function").length;
  const definedProperties = definedMembers.filter((member) => member.kind === "property").length;
  const memberLines = definedMembers.reduce((sum, member) => sum + (member.metrics?.lines || 1), 0);
  const fileLines = state.graph.nodes.find((candidate) => candidate.kind === "file" && candidate.file === node.file)?.metrics?.lines || 0;

  const variables = Math.max(
    node.kind === "property" ? 1 : 0,
    metrics.properties || 0,
    definedProperties,
    edgeCounts.ownedState || 0
  );
  const functions = Math.max(
    node.kind === "function" ? 1 : 0,
    metrics.methods || 0,
    definedFunctions,
    node.kind === "function" ? (metrics.calls || 0) + (metrics.branches || 0) * 2 : 0
  );
  const hasExplicitLines = Number.isFinite(metrics.lines) && metrics.lines > 0;
  let lines = hasExplicitLines
    ? metrics.lines
    : Math.max(1, memberLines || (node.kind === "file" ? fileLines || 30 : 8));
  if (!hasExplicitLines) {
    lines = Math.max(lines, variables, functions);
  }

  return { lines, variables, functions };
}

function complexityForNode(node) {
  if (node.kind === "file") return 1;
  const edgeCounts = graphEdgeCountsForNode(node.id);
  if (node.kind === "function") {
    const lineWeight = Math.sqrt(node.metrics?.lines || 2) * 0.42;
    const branchWeight = (node.metrics?.branches || 0) * 0.95;
    const callWeight = Math.sqrt(node.metrics?.calls || 0) * 0.5;
    const dependencyWeight = edgeCounts.outgoingUses * 0.8 + edgeCounts.memberUses * 0.65 + edgeCounts.incoming * 0.25;
    return clamp(0.9 + lineWeight + branchWeight + callWeight + dependencyWeight, 0.85, 18);
  }
  if (node.kind === "property") {
    return clamp(0.72 + edgeCounts.incoming * 0.45 + edgeCounts.outgoingUses * 0.35, 0.65, 5);
  }
  if (node.kind === "module") return 0.85;
  if (node.kind === "repository") return 2.2;

  const lines = Math.max(1, node.metrics?.lines || 1);
  const methodWeight = Math.log1p(node.metrics?.methods || 0) * 2.4;
  const propertyWeight = Math.log1p(node.metrics?.properties || 0) * 2;
  const lineWeight = Math.log1p(lines) * 1.4;
  const structuralWeight = Math.log1p(edgeCounts.definedMembers + edgeCounts.outgoingUses + edgeCounts.incoming) * 1.6;
  const kindWeight = node.kind === "swiftui_view" ? 1.35 : 1;
  return clamp((lineWeight + methodWeight + propertyWeight + structuralWeight) * kindWeight, 0.9, 100);
}

function graphEdgeCountsForNode(nodeId) {
  if (!state.graph) {
    return { incoming: 0, outgoingUses: 0, memberUses: 0, definedMembers: 0, ownedState: 0 };
  }
  const counts = { incoming: (state.edgesByTo.get(nodeId) || []).length, outgoingUses: 0, memberUses: 0, definedMembers: 0, ownedState: 0 };
  return (state.edgesByFrom.get(nodeId) || []).reduce((counts, edge) => {
    if (["uses", "imports", "conforms_to"].includes(edge.kind)) counts.outgoingUses += 1;
    if (edge.kind === "uses_member" || edge.kind === "owns_state") counts.memberUses += 1;
    if (edge.kind === "owns_state") counts.ownedState += 1;
    if (edge.kind === "defines") counts.definedMembers += 1;
    return counts;
  }, counts);
}

function baseDimensionsForKind(kind) {
  if (kind === "repository") return { width: 72, depth: 72, height: 34 };
  if (kind === "file") return { width: 72, depth: 48, height: 3 };
  if (kind === "swiftui_view") return { width: 34, depth: 34, height: 34 };
  if (kind === "service" || kind === "class") return { width: 32, depth: 32, height: 52 };
  if (kind === "function") return { width: 10, depth: 10, height: 12 };
  if (kind === "property") return { width: 8, depth: 8, height: 8 };
  if (kind === "module") return { width: 38, depth: 38, height: 10 };
  if (kind === "protocol") return { width: 26, depth: 26, height: 40 };
  return { width: 30, depth: 30, height: 30 };
}

function makeNodeGeometry(kind, width, height, depth) {
  const roundedWidth = Math.round(width);
  const roundedHeight = Math.round(height);
  const roundedDepth = Math.round(depth);
  const key = `${kind}:${roundedWidth}:${roundedHeight}:${roundedDepth}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  let geometry;
  if (kind === "module") {
    const radius = Math.max(7, Math.min(roundedWidth, roundedDepth) / 2);
    geometry = new THREE.TorusGeometry(radius, Math.max(2, roundedHeight / 3), 8, 20);
    geometry.rotateX(Math.PI / 2);
  } else if (isStructuralBuilding(kind)) {
    geometry = new THREE.BoxGeometry(roundedWidth, roundedHeight, roundedDepth);
  } else if (kind === "file") {
    geometry = new THREE.BoxGeometry(roundedWidth, roundedHeight, roundedDepth);
  } else if (kind === "function" || kind === "protocol") {
    geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, kind === "protocol" ? 8 : 14);
    geometry.scale(roundedWidth, roundedHeight, roundedDepth);
  } else if (kind === "property") {
    geometry = new THREE.SphereGeometry(0.5, 14, 10);
    geometry.scale(roundedWidth, roundedHeight, roundedDepth);
  } else {
    geometry = new THREE.BoxGeometry(roundedWidth, roundedHeight, roundedDepth);
  }

  geometryCache.set(key, geometry);
  return geometry;
}

function getNodeMaterial(kind, variant, options) {
  return getStandardMaterial(`node:${variant}:${kind}`, options);
}

function getStandardMaterial(key, options) {
  const cached = materialCache.get(`standard:${key}`);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial(options);
  materialCache.set(`standard:${key}`, material);
  return material;
}

function getBasicMaterial(key, options) {
  const cached = materialCache.get(`basic:${key}`);
  if (cached) return cached;
  const material = new THREE.MeshBasicMaterial(options);
  materialCache.set(`basic:${key}`, material);
  return material;
}

function edgeColor(kind) {
  if (kind === "uses") return 0xff4f5f;
  if (kind === "imports") return 0x63d2ff;
  if (kind === "owns_state") return 0xff6b78;
  return 0xffffff;
}

function edgeRenderColor(edge) {
  if (edge.source === "xcode-index") return 0xffd166;
  return edgeColor(edge.kind);
}

function edgeOpacity(edge) {
  if (edge.source === "xcode-index") return 0.82;
  return edge.inferred ? 0.38 : 0.72;
}

function edgeTubeRadius(edge) {
  if (edge.source === "xcode-index") return 1.45;
  return edge.inferred ? 0.8 : 1.15;
}

function makeArrowHead(points, color) {
  const tip = points[Math.max(1, points.length - 2)];
  const tail = points[Math.max(0, points.length - 5)];
  const direction = new THREE.Vector3().subVectors(tip, tail).normalize();
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.58 });
  const arrow = new THREE.Mesh(arrowHeadGeometry, material);
  arrow.position.copy(tip);
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  return arrow;
}

function describeKind(kind) {
  if (kind === "repository") return "whole scanned app";
  if (kind === "file") return "Swift source file";
  if (kind === "swiftui_view") return "SwiftUI screen or reusable view";
  if (kind === "service") return "service or store type";
  if (kind === "class") return "reference type";
  if (kind === "model" || kind === "struct") return "data model or value type";
  if (kind === "enum") return "enum definition";
  if (kind === "protocol") return "protocol contract";
  if (kind === "module") return "imported framework or module";
  if (kind === "function") return "method or function";
  if (kind === "property") return "stored or computed property / var";
  return "code structure";
}

function friendlyKind(kind) {
  if (kind === "swiftui_view") return "View";
  if (kind === "repository") return "App";
  if (kind === "module") return "Module";
  if (kind === "service") return "Service";
  if (kind === "function") return "Function";
  if (kind === "property") return "Property / Var";
  return kind.replaceAll("_", " ");
}

function getInspectableMemberIds(nodeId) {
  if (!state.graph) return [];
  return (state.edgesByFrom.get(nodeId) || [])
    .filter((edge) => edge.kind === "defines")
    .map((edge) => edge.to)
    .filter((memberId) => {
      const node = state.nodeById.get(memberId);
      return node?.kind === "function" || node?.kind === "property";
    });
}

function getPopupContentIds(nodeId) {
  const node = state.nodeById.get(nodeId);
  if (node?.kind === "file") return getXrayContentIds(nodeId);
  return getInspectableMemberIds(nodeId);
}

function getXrayContentIds(nodeId) {
  if (!state.graph) return [];
  const shell = state.nodeById.get(nodeId);
  return (state.edgesByFrom.get(nodeId) || [])
    .filter((edge) => edge.kind === "defines")
    .map((edge) => edge.to)
    .filter((childId) => {
      const child = state.nodeById.get(childId);
      if (!child) return false;
      if (shell?.kind === "file") {
        if (!state.showProtocols && child.kind === "protocol") return false;
        return child.kind !== "function" && child.kind !== "property";
      }
      return child.kind === "function" || child.kind === "property";
    });
}

function isOpenedShell(nodeId) {
  return nodeId === state.openShellId && getPopupContentIds(nodeId).length > 0;
}

function resolveOpenShellId(nodeId) {
  const popupContentIds = getPopupContentIds(nodeId);
  if (popupContentIds.length > 0) return nodeId;

  const node = state.nodeById.get(nodeId);
  if (node?.kind === "function" || node?.kind === "property") {
    return (state.edgesByTo.get(nodeId) || []).find((edge) => edge.kind === "defines")?.from || null;
  }

  return null;
}

function pickNodeIdFromIntersections(intersections) {
  if (intersections.length === 0) return null;

  const preferred = intersections.find((item) => !isOpenedShell(nodeIdFromObject(item.object)));
  return nodeIdFromObject((preferred || intersections[0]).object);
}

function pickEdgeFromIntersections(intersections) {
  const hit = intersections.find((item) => edgeFromObject(item.object));
  return hit ? edgeFromObject(hit.object) : null;
}

function nodeIdFromObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.role === "xray-inner") return null;
    if (current.userData?.nodeId) return current.userData.nodeId;
    current = current.parent;
  }
  return null;
}

function edgeFromObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.edge) return current.userData.edge;
    current = current.parent;
  }
  return null;
}

function edgeKey(edge, fallbackIndex = "") {
  if (edge.__renderKey) return edge.__renderKey;
  return `${edge.kind}:${edge.from}->${edge.to}:${edge.source || ""}:${edge.inferred ? "inferred" : "direct"}:${fallbackIndex}`;
}

function isPickableIntersection(intersection) {
  if (!nodeIdFromObject(intersection.object)) return false;
  let current = intersection.object;
  while (current) {
    if (current.userData?.role === "xray-inner") return false;
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

function shouldShowLabel(nodeId) {
  const node = state.nodeById.get(nodeId);
  if (!node) return false;
  if (isSearchMatch(node)) return true;
  if (state.performanceMode && node.id !== state.selectedId && node.id !== state.openShellId) return false;
  if (importantKinds.has(node.kind)) return true;
  if (node.kind === "function" || node.kind === "property") return false;
  return false;
}

function shouldCreateSearchHalo(node) {
  return node.kind !== "function" && node.kind !== "property";
}

function isSearchMatch(node) {
  return Boolean(state.query && node?.name?.toLowerCase().includes(state.query.toLowerCase()));
}

function shouldShowMesh(nodeId) {
  const node = state.nodeById.get(nodeId);
  if (!node) return false;
  if (node.kind === "function" || node.kind === "property") return false;
  return true;
}

function buildHoverXray(neighborhood) {
  const shellId = state.hoveredId || state.openShellId || state.selectedId;
  if (!shellId) return;
  const shell = state.layoutById.get(shellId);
  if (!shell || !shouldShowMesh(shell.id) || !isNodeVisible(shell, neighborhood)) return;

  addGlassObjectShell(shell);

  const memberIds = getXrayContentIds(shell.id);
  if (memberIds.length === 0) return;

  const members = memberIds
    .map((memberId) => state.nodeById.get(memberId))
    .filter(Boolean)
    .slice(0, 36);
  if (members.length === 0) return;

  const columns = Math.ceil(Math.sqrt(members.length));
  const rows = Math.ceil(members.length / columns);
  const innerWidth = Math.max(8, shell.width * 0.66);
  const innerDepth = Math.max(8, shell.depth * 0.66);
  const innerHeight = Math.max(8, shell.height * 0.82);
  const spacingX = columns > 1 ? innerWidth / (columns - 1) : 0;
  const spacingZ = rows > 1 ? innerDepth / (rows - 1) : 0;
  const itemSize = clamp(Math.min(innerWidth / Math.max(columns, 1), innerDepth / Math.max(rows, 1), innerHeight * 0.18), 4, 14);
  const minY = (shell.y || 0) + shell.height * 0.16;
  const maxY = (shell.y || 0) + shell.height * 0.88;

  members.forEach((member, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = shell.x + (columns === 1 ? 0 : column * spacingX - innerWidth / 2);
    const z = shell.z + (rows === 1 ? 0 : row * spacingZ - innerDepth / 2);
    const verticalT = members.length === 1 ? 0.5 : index / Math.max(1, members.length - 1);
    const y = minY + (maxY - minY) * verticalT;
    const geometry = makeNodeGeometry(member.kind, itemSize, itemSize * (member.kind === "function" ? 1.6 : 1), itemSize);
    const material = new THREE.MeshStandardMaterial({
      color: colorForNode(member),
      emissive: emissiveForNode(member),
      emissiveIntensity: 0.38,
      roughness: 0.52,
      metalness: 0.08,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      depthTest: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    applyKindRotation(mesh, member.kind);
    mesh.renderOrder = 24;
    mesh.userData = {
      role: "xray-inner"
    };
    xrayRoot.add(mesh);
  });
}

function applyPopupHoverMaterials() {
  popupRoot.traverse((object) => {
    if (!object.isMesh || !object.userData.nodeId || !object.material) return;
    if (object.userData.defaultPopupOpacity === undefined) {
      object.userData.defaultPopupOpacity = object.material.opacity ?? 1;
      object.userData.defaultPopupTransparent = Boolean(object.material.transparent);
      object.userData.defaultPopupDepthWrite = object.material.depthWrite ?? true;
      object.userData.defaultPopupWireframe = Boolean(object.material.wireframe);
    }
    const hovered = object.userData.nodeId === state.hoveredId;
    object.material.wireframe = hovered || object.userData.defaultPopupWireframe;
    object.material.opacity = hovered ? Math.min(object.userData.defaultPopupOpacity, 0.34) : object.userData.defaultPopupOpacity;
    object.material.transparent = hovered || object.userData.defaultPopupTransparent;
    object.material.depthWrite = hovered ? false : object.userData.defaultPopupDepthWrite;
    object.material.needsUpdate = true;
  });
}

function applyPopupEdgeSelection() {
  popupRoot.traverse((object) => {
    const edge = object.userData?.edge;
    if (!object.isMesh || !edge || !object.material) return;
    const isSelectedEdge = edgeKey(edge) === state.selectedEdgeKey;
    if (object.userData.popupEdgeRole === "road") {
      object.material.color.setHex(isSelectedEdge ? 0x2f3c18 : 0x10212a);
      object.material.opacity = isSelectedEdge ? 0.9 : popupEdgeOpacity(edge.kind) * 0.42;
    } else {
      object.material.color.setHex(isSelectedEdge ? 0xd7ff57 : popupEdgeColor(edge.kind));
      object.material.opacity = isSelectedEdge ? 1 : popupEdgeOpacity(edge.kind);
    }
  });
}

function buildPopupHoverXray() {
  if (!state.hoveredId || popupRoot.children.length === 0) return;

  const hoveredObject = findPopupObject(state.hoveredId);
  if (!hoveredObject) return;

  const box = new THREE.Box3().setFromObject(hoveredObject);
  if (box.isEmpty()) return;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const shell = {
    x: center.x,
    y: center.y - size.y / 2,
    z: center.z,
    width: Math.max(18, size.x),
    height: Math.max(20, size.y),
    depth: Math.max(18, size.z)
  };
  addGlassObjectShellToRoot(shell, popupXrayRoot, 42);
  buildPopupXrayInternals(shell, state.hoveredId);
}

function findPopupObject(nodeId) {
  let found = null;
  popupRoot.traverse((object) => {
    if (found || !object.isMesh || object.userData.nodeId !== nodeId) return;
    found = object;
  });
  return found;
}

function buildPopupXrayInternals(shell, nodeId) {
  const members = getXrayContentIds(nodeId)
    .map((memberId) => state.nodeById.get(memberId))
    .filter(Boolean)
    .slice(0, 24);
  if (members.length === 0) return;

  const columns = Math.ceil(Math.sqrt(members.length));
  const rows = Math.ceil(members.length / columns);
  const innerWidth = Math.max(8, shell.width * 0.62);
  const innerDepth = Math.max(8, shell.depth * 0.62);
  const spacingX = columns > 1 ? innerWidth / (columns - 1) : 0;
  const spacingZ = rows > 1 ? innerDepth / (rows - 1) : 0;
  const itemSize = clamp(Math.min(innerWidth / Math.max(columns, 1), innerDepth / Math.max(rows, 1), shell.height * 0.18), 3, 10);
  const minY = shell.y + shell.height * 0.18;
  const maxY = shell.y + shell.height * 0.86;

  members.forEach((member, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = shell.x + (columns === 1 ? 0 : column * spacingX - innerWidth / 2);
    const z = shell.z + (rows === 1 ? 0 : row * spacingZ - innerDepth / 2);
    const verticalT = members.length === 1 ? 0.5 : index / Math.max(1, members.length - 1);
    const y = minY + (maxY - minY) * verticalT;
    const geometry = makeNodeGeometry(member.kind, itemSize, itemSize * (member.kind === "function" ? 1.6 : 1), itemSize);
    const material = new THREE.MeshStandardMaterial({
      color: colorForNode(member),
      emissive: emissiveForNode(member),
      emissiveIntensity: 0.42,
      roughness: 0.5,
      metalness: 0.08,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    applyKindRotation(mesh, member.kind);
    mesh.renderOrder = 48;
    mesh.userData = { role: "xray-inner" };
    popupXrayRoot.add(mesh);
  });
}

function addGlassObjectShell(shell) {
  addGlassObjectShellToRoot(shell, xrayRoot, 20);
}

function addGlassObjectShellToRoot(shell, targetRoot, renderOrderBase) {
  const shellWidth = shell.width;
  const shellHeight = shell.height;
  const shellDepth = shell.depth;
  const center = new THREE.Vector3(shell.x, (shell.y || 0) + shell.height / 2, shell.z);
  const glassMaterial = getBasicMaterial("selected-glass-shell-fill", {
    color: 0x8fd8ff,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    depthTest: false
  });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(shellWidth, shellHeight, shellDepth), glassMaterial);
  glass.position.copy(center);
  glass.renderOrder = renderOrderBase;
  glass.userData = { role: "xray-inner" };
  targetRoot.add(glass);

  const edgeMaterial = getBasicMaterial("selected-glass-shell-edge-bars", {
    color: 0xa8ddff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: false
  });
  const edges = makeGlassBoxBars(shellWidth, shellHeight, shellDepth, Math.max(1.8, Math.min(shellWidth, shellDepth) * 0.018), edgeMaterial);
  edges.position.copy(center);
  edges.renderOrder = renderOrderBase + 2;
  edges.userData = { role: "xray-inner" };
  targetRoot.add(edges);

  const gridMaterial = getBasicMaterial("selected-glass-shell-grid-bars", {
    color: 0x8fd8ff,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    depthTest: false
  });
  const grid = new THREE.Group();
  const gridThickness = Math.max(0.9, Math.min(shellWidth, shellDepth) * 0.01);
  const levels = clamp(Math.floor(shellHeight / 26), 3, 9);
  for (let level = 1; level < levels; level += 1) {
    const y = -shellHeight / 2 + (shellHeight / levels) * level;
    const front = new THREE.Mesh(new THREE.BoxGeometry(shellWidth, gridThickness, gridThickness), gridMaterial);
    front.position.set(0, y, shellDepth / 2 + gridThickness);
    const side = new THREE.Mesh(new THREE.BoxGeometry(gridThickness, gridThickness, shellDepth), gridMaterial);
    side.position.set(shellWidth / 2 + gridThickness, y, 0);
    grid.add(front, side);
  }
  const columns = clamp(Math.floor(shellWidth / 28), 2, 6);
  for (let column = 1; column < columns; column += 1) {
    const x = -shellWidth / 2 + (shellWidth / columns) * column;
    const line = new THREE.Mesh(new THREE.BoxGeometry(gridThickness, shellHeight, gridThickness), gridMaterial);
    line.position.set(x, 0, shellDepth / 2 + gridThickness);
    grid.add(line);
  }
  grid.position.copy(center);
  grid.renderOrder = renderOrderBase + 1;
  grid.userData = { role: "xray-inner" };
  targetRoot.add(grid);
}

function makeGlassBoxBars(width, height, depth, thickness, material) {
  const group = new THREE.Group();
  const xPositions = [-width / 2, width / 2];
  const yPositions = [-height / 2, height / 2];
  const zPositions = [-depth / 2, depth / 2];

  yPositions.forEach((y) => {
    zPositions.forEach((z) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(width + thickness, thickness, thickness), material);
      bar.position.set(0, y, z);
      group.add(bar);
    });
    xPositions.forEach((x) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, depth + thickness), material);
      bar.position.set(x, y, 0);
      group.add(bar);
    });
  });

  xPositions.forEach((x) => {
    zPositions.forEach((z) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(thickness, height + thickness, thickness), material);
      bar.position.set(x, 0, z);
      group.add(bar);
    });
  });

  return group;
}

function resetDynamicLayout() {
  for (const mesh of state.meshById.values()) {
    mesh.position.copy(mesh.userData.defaultPosition);
    mesh.scale.copy(mesh.userData.defaultScale);
    if (mesh.material) {
      mesh.material.wireframe = mesh.userData.defaultWireframe;
      mesh.material.opacity = mesh.userData.defaultOpacity ?? 1;
      mesh.material.transparent = Boolean(mesh.userData.defaultTransparent);
      mesh.material.depthWrite = mesh.userData.defaultDepthWrite ?? true;
      mesh.material.needsUpdate = true;
      if (typeof mesh.userData.defaultEmissiveIntensity === "number") {
        mesh.material.emissiveIntensity = mesh.userData.defaultEmissiveIntensity;
      }
    }
  }
  for (const label of state.labelById.values()) {
    label.position.copy(label.userData.defaultPosition);
  }
}

function buildMemberPopup() {
  disposeGroupMaterials(popupRoot);
  disposeGroupMaterials(popupXrayRoot);
  popupRoot.clear();
  popupXrayRoot.clear();
  state.popupFocusTarget = null;

  const shellNode = state.layoutById.get(state.openShellId);
  if (!shellNode) return;
  const isFilePopup = shellNode.kind === "file";
  const contentIds = getPopupContentIds(state.openShellId);
  if (contentIds.length === 0) return;

  const visibleMemberIds = contentIds.filter((memberId) => {
    const member = state.nodeById.get(memberId);
    if (isFilePopup && member?.kind === "protocol" && !state.showProtocols) return false;
    return member?.kind !== "property" || state.showProperties;
  });
  if (visibleMemberIds.length === 0) return;

  const dependencyIds = getPopupDependencyIds(shellNode.id, visibleMemberIds);
  const memberNodes = visibleMemberIds.map((memberId) => state.layoutById.get(memberId)).filter(Boolean);
  const dependencyNodes = dependencyIds
    .map((dependencyId) => state.layoutById.get(dependencyId) || state.nodeById.get(dependencyId))
    .filter(Boolean);
  const parentDimensions = popupDimensionsForParent(shellNode, visibleMemberIds.length);
  const memberLayout = isFilePopup
    ? popupFileChildLayout(shellNode, memberNodes, parentDimensions)
    : popupContainedChildLayout(memberNodes, parentDimensions);
  const dependencyLayout = popupGridLayout(dependencyNodes, popupDimensionsForDependency);
  const maxMemberHeight = memberNodes.reduce((value, node, index) => {
    const dimensions = isFilePopup ? memberLayout.dimensions[index] : popupDimensionsForMember(node);
    return Math.max(value, dimensions?.height || 0);
  }, 0);
  const maxDependencyHeight = dependencyNodes.reduce((value, node) => Math.max(value, popupDimensionsForDependency(node).height), 0);
  const contentWidth = Math.max(memberLayout.width, dependencyLayout.width, Math.max(44, shellNode.width * 0.42));
  const contentDepth = Math.max(memberLayout.depth + dependencyLayout.depth + 96, 180);
  const frameWidth = Math.max(260, contentWidth + parentDimensions.width + 120);
  const frameHeight = Math.max(
    190,
    parentDimensions.height + 72,
    maxMemberHeight + 92,
    maxDependencyHeight + 154
  );
  const frameDepth = Math.max(230, contentDepth + parentDimensions.depth + 82);
  const shellTop = (shellNode.y || 0) + shellNode.height;
  const popupGap = clamp(shellNode.width * 0.55 + frameWidth * 0.55 + 220, 360, 760);
  const popupLift = clamp(shellNode.height * 0.45 + frameHeight * 0.35 + 190, 280, 620);
  const origin = new THREE.Vector3(shellNode.x + popupGap, shellTop + popupLift, shellNode.z);
  state.popupFocusTarget = {
    nodeId: shellNode.id,
    target: new THREE.Vector3(origin.x, origin.y + 10, origin.z),
    distance: clamp(Math.max(frameWidth, frameHeight, frameDepth) * 2.2, 360, 920)
  };
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(frameWidth, frameHeight, frameDepth),
    getBasicMaterial("popup-frame", { color: 0x63d2ff, wireframe: true, transparent: true, opacity: 0.38 })
  );
  frame.position.copy(origin);
  popupRoot.add(frame);

  const floorSize = Math.max(frameWidth, frameDepth);
  const floorPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(frameWidth, frameDepth),
    getStandardMaterial("popup-floor", {
      color: 0x0d2028,
      roughness: 0.9,
      metalness: 0.04,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide
    })
  );
  floorPlate.rotation.x = -Math.PI / 2;
  floorPlate.position.set(origin.x, origin.y - frameHeight / 2 + 2, origin.z);
  popupRoot.add(floorPlate);

  const floor = new THREE.GridHelper(floorSize, Math.max(4, Math.ceil(floorSize / 42)), 0x2a6074, 0x15303b);
  floor.position.set(origin.x, origin.y - frameHeight / 2 + 4, origin.z);
  popupRoot.add(floor);

  const title = makeLabel(`Inspecting ${shellNode.name}`, "#dff6ff", 104, 12);
  title.position.set(origin.x, origin.y + frameHeight / 2 + 18, origin.z);
  popupRoot.add(title);

  const positions = new Map();
  const parentPosition = new THREE.Vector3(origin.x, origin.y - frameHeight / 2 + 18 + parentDimensions.height / 2, origin.z);
  const parentMesh = new THREE.Mesh(
    makeNodeGeometry(shellNode.kind, parentDimensions.width, parentDimensions.height, parentDimensions.depth),
    getNodeMaterial(shellNode.kind, "popup-parent", {
      color: colors[shellNode.kind] || 0x95a4ad,
      roughness: 0.56,
      metalness: 0.12,
      emissive: colors[shellNode.kind] || 0x000000,
      emissiveIntensity: 0.12,
      transparent: true,
      opacity: 0.22,
      depthWrite: false
    })
  );
  parentMesh.position.copy(parentPosition);
  parentMesh.userData.nodeId = shellNode.id;
  popupRoot.add(parentMesh);
  if (shellNode.kind === "file") {
    addPopupFileLocInlay(parentMesh, shellNode, parentDimensions);
  }
  positions.set(shellNode.id, parentPosition.clone());
  const parentLabel = makeLabel(shellNode.name, "#e6fbff", 66, 10);
  parentLabel.position.set(parentPosition.x, parentPosition.y + Math.max(14, shellNode.height * 0.2 + 14), parentPosition.z);
  popupRoot.add(parentLabel);

  if (isFilePopup) {
    placePopupFileChildren(visibleMemberIds, parentPosition, parentDimensions, shellNode, positions, memberLayout);
  } else {
    placePopupContainedMembers(visibleMemberIds, parentPosition, parentDimensions, positions, memberLayout);
  }
  placePopupDependencies(dependencyIds, origin, frameHeight, positions, dependencyLayout);

  getPopupEdges(shellNode.id, visibleMemberIds, dependencyIds).forEach((edge) => drawPopupEdge(edge, positions));
}

function placePopupFileChildren(childIds, parentPosition, parentDimensions, shellNode, positions, layoutInfo) {
  childIds.forEach((childId, index) => {
    const node = state.layoutById.get(childId);
    if (!node) return;
    const base = layoutInfo.positions[index] || { x: 0, z: 0 };
    const dimensions = layoutInfo.dimensions[index] || popupDimensionsForFileChild(node, layoutInfo.scale);
    const position = new THREE.Vector3(
      parentPosition.x + base.x,
      parentPosition.y + parentDimensions.height / 2 + 8 + dimensions.height / 2,
      parentPosition.z + base.z
    );
    const material = getNodeMaterial(node.kind, "popup-file-child", {
      color: colorForNode(node),
      roughness: 0.56,
      metalness: node.kind === "swiftui_view" ? 0.18 : 0.1,
      emissive: emissiveForNode(node),
      emissiveIntensity: 0.16,
      transparent: false,
      opacity: cityObjectOpacity(node.kind),
      depthWrite: true
    });
    const mesh = new THREE.Mesh(makeNodeGeometry(node.kind, dimensions.width, dimensions.height, dimensions.depth), material);
    mesh.position.copy(position);
    applyKindRotation(mesh, node.kind);
    mesh.userData.nodeId = childId;
    mesh.castShadow = true;
    popupRoot.add(mesh);
    positions.set(childId, position.clone());

    const label = makeLabel(node.name, node.kind === "swiftui_view" ? "#dfffee" : "#ffffff", 58, 10);
    label.position.set(position.x, position.y + dimensions.height / 2 + 13, position.z);
    popupRoot.add(label);
  });
}

function placePopupMembers(memberIds, origin, frameHeight, positions, layoutInfo) {
  memberIds.forEach((memberId, index) => {
    const node = state.layoutById.get(memberId);
    if (!node) return;
    const base = layoutInfo.positions[index] || { x: 0, z: 0 };
    const layerY = node.kind === "function" ? 42 : 12;
    const dimensions = popupDimensionsForMember(node);
    const position = new THREE.Vector3(
      origin.x + base.x,
      origin.y - frameHeight / 2 + layerY + dimensions.height / 2,
      origin.z + base.z + layoutInfo.depth * 0.22
    );
    const material = getNodeMaterial(node.kind, "popup-member", {
      color: colorForNode(node),
      roughness: 0.56,
      metalness: 0.1,
      emissive: emissiveForNode(node),
      emissiveIntensity: 0.16,
      transparent: false,
      opacity: cityObjectOpacity(node.kind),
      depthWrite: true
    });
    const boxWidth = dimensions.width;
    const boxHeight = dimensions.height;
    const boxDepth = dimensions.depth;
    const mesh = new THREE.Mesh(makeNodeGeometry(node.kind, boxWidth, boxHeight, boxDepth), material);
    mesh.position.copy(position);
    mesh.userData.nodeId = memberId;
    mesh.castShadow = true;
    popupRoot.add(mesh);
    positions.set(memberId, position.clone());

    const label = makeLabel(node.name, node.kind === "property" ? "#d7e3ea" : "#ffffff", 56, 10);
    label.position.set(position.x, position.y + boxHeight / 2 + 13, position.z);
    popupRoot.add(label);
  });
}

function placePopupContainedMembers(memberIds, parentPosition, parentDimensions, positions, layoutInfo) {
  memberIds.forEach((memberId, index) => {
    const node = state.layoutById.get(memberId);
    if (!node) return;
    const base = layoutInfo.positions[index] || { x: 0, z: 0, y: 0.5 };
    const dimensions = layoutInfo.dimensions[index] || popupDimensionsForContainedMember(node, layoutInfo.itemSize || 8);
    const minY = parentPosition.y - parentDimensions.height / 2 + dimensions.height / 2 + 6;
    const maxY = parentPosition.y + parentDimensions.height / 2 - dimensions.height / 2 - 6;
    const position = new THREE.Vector3(
      parentPosition.x + base.x,
      clamp(parentPosition.y + base.y, minY, Math.max(minY, maxY)),
      parentPosition.z + base.z
    );
    const material = getNodeMaterial(node.kind, "popup-contained-member", {
      color: colorForNode(node),
      roughness: 0.56,
      metalness: 0.1,
      emissive: emissiveForNode(node),
      emissiveIntensity: 0.14,
      transparent: false,
      opacity: cityObjectOpacity(node.kind),
      depthWrite: true
    });
    const mesh = new THREE.Mesh(makeNodeGeometry(node.kind, dimensions.width, dimensions.height, dimensions.depth), material);
    mesh.position.copy(position);
    applyKindRotation(mesh, node.kind);
    mesh.userData.nodeId = memberId;
    mesh.castShadow = true;
    popupRoot.add(mesh);
    positions.set(memberId, position.clone());

    if (index < 80) {
      const label = makeLabel(node.name, node.kind === "property" ? "#d7e3ea" : "#ffffff", 44, 8);
      label.position.set(position.x, position.y + dimensions.height / 2 + 9, position.z);
      popupRoot.add(label);
    }
  });
}

function placePopupDependencies(dependencyIds, origin, frameHeight, positions, layoutInfo) {
  dependencyIds.forEach((dependencyId, index) => {
    const node = state.layoutById.get(dependencyId) || state.nodeById.get(dependencyId);
    if (!node) return;
    const base = layoutInfo.positions[index] || { x: 0, z: 0 };
    const dimensions = popupDimensionsForDependency(node);
    const position = new THREE.Vector3(
      origin.x + base.x,
      origin.y - frameHeight / 2 + 104 + dimensions.height / 2,
      origin.z + base.z - layoutInfo.depth * 0.42 - 48
    );
    const material = getNodeMaterial(node.kind, "popup-dependency", {
      color: colors[node.kind] || 0xa7c4ff,
      roughness: 0.62,
      metalness: 0.08,
      emissive: colors[node.kind] || 0xa7c4ff,
      emissiveIntensity: 0.06
    });
    const boxWidth = dimensions.width;
    const boxHeight = dimensions.height;
    const boxDepth = dimensions.depth;
    const mesh = new THREE.Mesh(makeNodeGeometry(node.kind, boxWidth, boxHeight, boxDepth), material);
    mesh.position.copy(position);
    mesh.userData.nodeId = dependencyId;
    popupRoot.add(mesh);
    positions.set(dependencyId, position.clone());

    const label = makeLabel(node.name, "#dbeaff", 58, 10);
    label.position.set(position.x, position.y + boxHeight / 2 + 13, position.z);
    popupRoot.add(label);
  });
}

function popupFileChildLayout(shellNode, childNodes, parentDimensions) {
  const scaleX = parentDimensions.width / Math.max(1, shellNode.width || parentDimensions.width);
  const scaleZ = parentDimensions.depth / Math.max(1, shellNode.depth || parentDimensions.depth);
  const scale = Math.min(scaleX, scaleZ);
  const positions = childNodes.map((node, index) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.z)) {
      return gridPosition(index, childNodes.length, 42, 38);
    }
    return {
      x: (node.x - shellNode.x) * scaleX,
      z: (node.z - shellNode.z) * scaleZ
    };
  });
  const dimensions = childNodes.map((node) => popupDimensionsForFileChild(node, scale));
  const bounds = positions.reduce((result, position, index) => {
    const dimensionsForNode = dimensions[index] || { width: 0, depth: 0 };
    return {
      minX: Math.min(result.minX, position.x - dimensionsForNode.width / 2),
      maxX: Math.max(result.maxX, position.x + dimensionsForNode.width / 2),
      minZ: Math.min(result.minZ, position.z - dimensionsForNode.depth / 2),
      maxZ: Math.max(result.maxZ, position.z + dimensionsForNode.depth / 2)
    };
  }, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  return {
    width: Math.max(parentDimensions.width, bounds.maxX - bounds.minX),
    depth: Math.max(parentDimensions.depth, bounds.maxZ - bounds.minZ),
    positions,
    dimensions,
    scale
  };
}

function popupContainedChildLayout(nodes, parentDimensions) {
  if (nodes.length === 0) {
    return { width: parentDimensions.width, depth: parentDimensions.depth, positions: [], dimensions: [], itemSize: 8 };
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const usableWidth = Math.max(20, parentDimensions.width * 0.76);
  const usableDepth = Math.max(20, parentDimensions.depth * 0.76);
  const spacingX = columns <= 1 ? 0 : usableWidth / (columns - 1);
  const spacingZ = rows <= 1 ? 0 : usableDepth / (rows - 1);
  const itemSize = clamp(Math.min(usableWidth / Math.max(1, columns), usableDepth / Math.max(1, rows)) * 0.72, 3.5, 14);
  const minY = -parentDimensions.height * 0.32;
  const maxY = parentDimensions.height * 0.32;
  const positions = nodes.map((_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const verticalT = nodes.length === 1 ? 0.5 : index / Math.max(1, nodes.length - 1);
    return {
      x: columns === 1 ? 0 : column * spacingX - usableWidth / 2,
      z: rows === 1 ? 0 : row * spacingZ - usableDepth / 2,
      y: minY + (maxY - minY) * verticalT
    };
  });
  return {
    width: parentDimensions.width,
    depth: parentDimensions.depth,
    positions,
    dimensions: nodes.map((node) => popupDimensionsForContainedMember(node, itemSize)),
    itemSize
  };
}

function popupGridLayout(nodes, dimensionsForPopupNode) {
  if (nodes.length === 0) {
    return { columns: 1, rows: 0, width: 0, depth: 0, cellWidth: 0, cellDepth: 0, positions: [] };
  }
  const dimensions = nodes.map((node) => dimensionsForPopupNode(node));
  const maxWidth = dimensions.reduce((value, item) => Math.max(value, item.width), 0);
  const maxDepth = dimensions.reduce((value, item) => Math.max(value, item.depth), 0);
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const cellWidth = Math.max(84, maxWidth + Math.max(46, maxWidth * 0.32));
  const cellDepth = Math.max(76, maxDepth + Math.max(42, maxDepth * 0.32));
  return {
    columns,
    rows,
    width: Math.max(cellWidth, columns * cellWidth),
    depth: Math.max(cellDepth, rows * cellDepth),
    cellWidth,
    cellDepth,
    positions: nodes.map((_, index) => gridPosition(index, nodes.length, cellWidth, cellDepth))
  };
}

function popupDimensionsForFileChild(node, scale) {
  return {
    width: Math.max(12, (node.width || 24) * scale),
    height: Math.max(14, (node.height || 24) * 0.48),
    depth: Math.max(12, (node.depth || 24) * scale)
  };
}

function popupDimensionsForMember(node) {
  const sizeBoost = node.kind === "function" ? 1.65 : 1.38;
  return {
    width: Math.max(12, node.width * sizeBoost),
    height: Math.max(10, node.height * sizeBoost),
    depth: Math.max(12, node.depth * sizeBoost)
  };
}

function popupDimensionsForContainedMember(node, itemSize) {
  return {
    width: Math.max(4, itemSize * (node.kind === "property" ? 0.92 : 1.25)),
    height: Math.max(4, itemSize * (node.kind === "function" ? 1.7 : node.kind === "property" ? 0.92 : 1.35)),
    depth: Math.max(4, itemSize * (node.kind === "property" ? 0.92 : 1.25))
  };
}

function popupDimensionsForParent(node, childCount = 0) {
  if (node.kind !== "file") {
    const childFootprint = Math.sqrt(Math.max(1, childCount)) * 24;
    return {
      width: Math.max(44, node.width * 0.82, childFootprint),
      height: Math.max(54, node.height * 0.72, Math.sqrt(Math.max(1, childCount)) * 10),
      depth: Math.max(44, node.depth * 0.82, childFootprint)
    };
  }
  return {
    width: Math.max(28, node.width * 0.38),
    height: Math.max(18, node.height * 0.38),
    depth: Math.max(28, node.depth * 0.38)
  };
}

function addPopupFileLocInlay(parentMesh, shellNode, parentDimensions) {
  const scaleX = parentDimensions.width / Math.max(1, shellNode.width || parentDimensions.width);
  const scaleZ = parentDimensions.depth / Math.max(1, shellNode.depth || parentDimensions.depth);
  const inlayNode = {
    ...shellNode,
    width: Math.max(10, (shellNode.locWidth || shellNode.width || 36) * scaleX),
    depth: Math.max(8, (shellNode.locDepth || shellNode.depth || 28) * scaleZ),
    locWidth: Math.max(10, (shellNode.locWidth || shellNode.width || 36) * scaleX),
    locDepth: Math.max(8, (shellNode.locDepth || shellNode.depth || 28) * scaleZ)
  };
  const inlay = makeFileMarker(inlayNode);
  inlay.position.set(0, parentDimensions.height / 2 + 0.8, 0);
  inlay.userData = { role: "popup-file-loc-inlay" };
  parentMesh.add(inlay);
}

function popupDimensionsForDependency(node) {
  return {
    width: Math.max(18, (node.width || 24) * 0.9),
    height: Math.max(12, (node.height || 18) * 0.9),
    depth: Math.max(18, (node.depth || 24) * 0.9)
  };
}

function getPopupDependencyIds(parentId, memberIds) {
  const memberSet = new Set(memberIds);
  return uniqueValues((state.edgesByFrom.get(parentId) || [])
    .filter((edge) => ["uses", "conforms_to", "imports"].includes(edge.kind))
    .map((edge) => edge.to)
    .filter((nodeId) => nodeId !== parentId && !memberSet.has(nodeId)));
}

function getPopupEdges(parentId, memberIds, dependencyIds) {
  const visibleIds = new Set([parentId, ...memberIds, ...dependencyIds]);
  const edges = [];

  const candidates = uniqueValues([
    ...(state.edgesByFrom.get(parentId) || []),
    ...memberIds.flatMap((memberId) => state.edgesByFrom.get(memberId) || [])
  ]);

  candidates.forEach((edge, edgeIndex) => {
    if (!isEdgeVisible(edge)) return;
    edge.__renderKey = edge.__renderKey || edgeKey(edge, edgeIndex);
    if (edge.kind === "defines" && edge.from === parentId && visibleIds.has(edge.to)) edges.push(edge);
    if (edge.kind === "owns_state" && edge.from === parentId && visibleIds.has(edge.to)) edges.push(edge);
    if (["uses", "conforms_to", "imports"].includes(edge.kind) && edge.from === parentId && visibleIds.has(edge.to)) edges.push(edge);
    if (edge.kind === "uses_member" && visibleIds.has(edge.from) && visibleIds.has(edge.to)) edges.push(edge);
  });

  return edges;
}

function isEdgeKindEnabled(kind) {
  return state.edgeFilters[kind] !== false;
}

function drawPopupEdge(edge, positions) {
  const fromPosition = positions.get(edge.from);
  const toPosition = positions.get(edge.to);
  if (!fromPosition || !toPosition) return;
  const curve = popupStreetCurveForEdge(fromPosition, toPosition);
  const points = curve.getPoints(18);
  const color = popupEdgeColor(edge.kind);
  const positionKey = `${Math.round(fromPosition.x)}:${Math.round(fromPosition.y)}:${Math.round(fromPosition.z)}:${Math.round(toPosition.x)}:${Math.round(toPosition.y)}:${Math.round(toPosition.z)}`;
  const roadGeometry = getCachedTubeGeometry(`${edgeKey(edge)}:popup-road:${positionKey}`, curve, 18, 2.6);
  const roadMaterial = new THREE.MeshBasicMaterial({
    color: 0x10212a,
    transparent: true,
    opacity: popupEdgeOpacity(edge.kind) * 0.42,
    depthWrite: false
  });
  const road = new THREE.Mesh(roadGeometry, roadMaterial);
  const geometry = getCachedTubeGeometry(`${edgeKey(edge)}:popup-line:${positionKey}`, curve, 18, 0.75);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: popupEdgeOpacity(edge.kind), depthWrite: false });
  const line = new THREE.Mesh(geometry, material);
  const arrow = makeArrowHead(points, color);
  arrow.material.opacity = popupEdgeOpacity(edge.kind);
  road.userData.edge = edge;
  road.userData.popupEdgeRole = "road";
  line.userData.edge = edge;
  line.userData.popupEdgeRole = "line";
  arrow.userData.edge = edge;
  arrow.userData.popupEdgeRole = "arrow";
  const group = new THREE.Group();
  group.userData.edge = edge;
  group.userData.edgeKey = edgeKey(edge);
  group.add(road, line, arrow);
  popupRoot.add(group);
}

function popupStreetCurveForEdge(fromPosition, toPosition) {
  const start = fromPosition.clone();
  const end = toPosition.clone();
  const streetY = Math.min(start.y, end.y) + 2;
  start.y = streetY;
  end.y = streetY + 0.2;
  const horizontalFirst = Math.abs(end.x - start.x) > Math.abs(end.z - start.z);
  const route = new THREE.CurvePath();
  const jog = rectangularStreetJog(start, end, horizontalFirst);
  [start, ...jog, end].forEach((point, index, points) => {
    if (index === 0) return;
    const previous = points[index - 1];
    if (previous.distanceTo(point) > 0.1) route.add(new THREE.LineCurve3(previous, point));
  });
  return route;
}

function popupEdgeColor(kind) {
  if (kind === "defines") return 0xb9d8e8;
  if (kind === "uses_member") return 0x7cf1b8;
  if (kind === "owns_state") return 0xff6b78;
  if (kind === "conforms_to") return 0xffffff;
  return edgeColor(kind);
}

function popupEdgeOpacity(kind) {
  if (kind === "defines") return 0.34;
  if (kind === "owns_state") return 0.58;
  return 0.74;
}

function popupEdgeLift(kind) {
  if (kind === "defines") return 18;
  if (kind === "conforms_to") return 42;
  return 30;
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function showStartupError(error) {
  pickerStatus.textContent = error.message;
  scanSummary.textContent = "Scan did not complete.";
  projectName.textContent = "Failed to load universe";
  selectedDetails.innerHTML = `<p><strong>Startup error</strong><br><code>${escapeHtml(error.message)}</code></p>`;
  console.error(error);
}
