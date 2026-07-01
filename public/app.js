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

const colors = {
  repository: 0x63d2ff,
  file: 0x7fa3b8,
  swiftui_view: 0x7cf1b8,
  service: 0xf6c762,
  class: 0xf6c762,
  model: 0xbca4ff,
  struct: 0xbca4ff,
  enum: 0xbca4ff,
  protocol: 0xa7c4ff,
  function: 0xe8eef2,
  property: 0x9fb0ba,
  module: 0x6d7b84
};

const geometryCache = new Map();
const materialCache = new Map();
const arrowHeadGeometry = new THREE.ConeGeometry(4.5, 11, 14);
const lastProjectPathKey = "codeUniverse.lastProjectPath";
const parserModeKey = "codeUniverse.parserMode";

const importantKinds = new Set(["file", "swiftui_view", "service", "class", "model", "struct", "enum", "protocol"]);

const state = {
  graph: null,
  layout: [],
  selectedId: null,
  openShellId: null,
  query: "",
  showEdges: true,
  edgeDensity: "normal",
  selectedEdgesOnly: false,
  focusMode: false,
  showFiles: true,
  showModules: true,
  showProperties: true,
  parserMode: "heuristic",
  parserComparison: null,
  performanceMode: false,
  edgeFilters: {
    uses: true,
    imports: true,
    conforms_to: true,
    defines: true,
    owns_state: true,
    uses_member: true,
    inferred: true,
    "xcode-index": true
  },
  pressedKeys: new Set(),
  pointer: new THREE.Vector2(),
  pointerDown: null,
  dragDistance: 0,
  meshById: new Map(),
  labelById: new Map(),
  cameraAnimation: null,
  popupFocusTarget: null,
  hoveredId: null,
  mapRadius: 900
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1218);
scene.fog = new THREE.Fog(0x0a1218, 2600, 6200);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 12000);
const defaultCameraPosition = new THREE.Vector3(0, 530, 760);
const defaultControlsTarget = new THREE.Vector3(0, 120, 0);
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

const universe = new THREE.Group();
const root = new THREE.Group();
const edgeRoot = new THREE.Group();
const popupRoot = new THREE.Group();
universe.add(root, edgeRoot, popupRoot);
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
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(5000, 100, 0x263946, 0x14212a);
grid.position.y = 1;
scene.add(grid);

bootstrap().catch(showStartupError);

async function bootstrap() {
  initializeParserMode();
  bindEvents();
  resize();
  renderer.setAnimationLoop(draw);
  await loadInitialUniverse();
}

function initializeParserMode() {
  state.parserMode = "heuristic";
  localStorage.setItem(parserModeKey, state.parserMode);
  parserSelect.value = state.parserMode;
}

async function loadInitialUniverse() {
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
  loadGraph(graph, "Sample Swift app");
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

  loadGraph(payload.graph, "Native Xcode scan");
  if (payload.diagnostics.sourceRoot) {
    localStorage.setItem(lastProjectPathKey, payload.diagnostics.sourceRoot);
  }
  pickerStatus.textContent = `Loaded ${payload.graph.project.name} with ${describeParser(payload.diagnostics.scanner)}.`;
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

  loadGraph(payload.graph, descriptor);
  localStorage.setItem(lastProjectPathKey, payload.diagnostics.sourceRoot);
  pickerStatus.textContent = `Loaded ${payload.graph.project.name} with ${describeParser(payload.diagnostics.scanner)}.`;
  scanSummary.textContent = formatScanSummary(payload.diagnostics);
}

async function compareParsers() {
  const sourceRoot = state.graph?.project?.sourceRoot || localStorage.getItem(lastProjectPathKey);
  if (!sourceRoot || sourceRoot === "examples/SampleSwiftApp") {
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

function loadGraph(graph, descriptor) {
  state.graph = graph;
  state.layout = buildLayout(graph);
  state.selectedId = null;
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
  selectNode(state.layout.find((item) => item.kind === "repository")?.id || state.layout[0]?.id);
  syncButtons();
}

function buildLayout(graph) {
  const files = graph.nodes.filter((node) => node.kind === "file");
  const types = graph.nodes.filter((node) => !["repository", "file", "module", "function", "property"].includes(node.kind));
  const functions = graph.nodes.filter((node) => node.kind === "function" || node.kind === "property");
  const modules = graph.nodes.filter((node) => node.kind === "module");
  const layout = [];

  layout.push({
    ...graph.nodes.find((node) => node.kind === "repository"),
    ...gridPosition(0, 1, 170, 150, 0, -230),
    y: 0,
    ...dimensionsForNode({ kind: "repository" })
  });

  files.forEach((file, index) => {
    layout.push({
      ...file,
      ...gridPosition(index, Math.max(1, files.length), 260, 225, 0, 20),
      y: 0,
      ...dimensionsForNode(file)
    });
  });

  types.forEach((type) => {
    const fileEdge = graph.edges.find((edge) => edge.kind === "defines" && edge.to === type.id);
    const parent = layout.find((item) => item.id === fileEdge?.from);
    const siblings = types.filter((candidate) => graph.edges.some((edge) => edge.kind === "defines" && edge.from === fileEdge?.from && edge.to === candidate.id));
    const siblingIndex = siblings.findIndex((candidate) => candidate.id === type.id);
    const offset = childPositionOnFilePlane(siblingIndex, Math.max(1, siblings.length), parent);
    layout.push({
      ...type,
      x: (parent?.x || 0) + offset.x,
      z: (parent?.z || 0) + offset.z,
      y: (parent?.y || 0) + (parent?.height || 0) + 22,
      ...dimensionsForNode(type)
    });
  });

  modules.forEach((moduleNode, index) => {
    layout.push({
      ...moduleNode,
      ...gridPosition(index, Math.max(1, modules.length), 125, 105, 0, -390),
      y: 72,
      ...dimensionsForNode(moduleNode)
    });
  });

  functions.forEach((node, index) => {
    const edge = graph.edges.find((candidate) => candidate.kind === "defines" && candidate.to === node.id);
    const parent = layout.find((item) => item.id === edge?.from);
    if (!parent) return;
    const position = gridPosition(index, Math.max(1, functions.length), 18, 18);
    layout.push({
      ...node,
      x: parent.x + position.x,
      z: parent.z + position.z,
      y: (parent.y || 0) + parent.height + 18,
      ...dimensionsForNode(node)
    });
  });

  return layout;
}

function buildScene() {
  root.clear();
  edgeRoot.clear();
  popupRoot.clear();
  state.meshById.clear();
  state.labelById.clear();

  for (const node of state.layout) {
    if (node.kind === "repository") continue;
    const material = new THREE.MeshStandardMaterial({
      color: colorForNode(node),
      roughness: 0.64,
      metalness: node.kind === "swiftui_view" ? 0.24 : 0.12,
      emissive: emissiveForNode(node),
      emissiveIntensity: node.kind === "swiftui_view" ? 0.08 : 0.02
    });
    const geometry = makeNodeGeometry(node.kind, node.width, node.height, node.depth);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(node.x, (node.y || 0) + node.height / 2, node.z);
    applyKindRotation(mesh, node.kind);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      nodeId: node.id,
      defaultPosition: mesh.position.clone(),
      defaultScale: mesh.scale.clone(),
      defaultWireframe: material.wireframe
    };
    if (node.kind === "function" || node.kind === "property") {
      mesh.visible = false;
    }
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

  for (const edge of state.graph.edges) {
    if (!isMainEdgeRenderable(edge)) continue;
    if (!isEdgeVisible(edge)) continue;
    const from = state.layout.find((node) => node.id === edge.from);
    const to = state.layout.find((node) => node.id === edge.to);
    if (!from || !to) continue;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(from.x, (from.y || 0) + from.height + 10, from.z),
      new THREE.Vector3((from.x + to.x) / 2, Math.max(from.height, to.height) + 92, (from.z + to.z) / 2),
      new THREE.Vector3(to.x, (to.y || 0) + to.height + 10, to.z)
    );
    const color = edgeRenderColor(edge);
    const points = curve.getPoints(24);
    const geometry = new THREE.TubeGeometry(curve, 24, edgeTubeRadius(edge), 6, false);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: edgeOpacity(edge),
      depthWrite: false
    });
    const line = new THREE.Mesh(geometry, material);
    const arrow = makeArrowHead(points, color);
    arrow.material.opacity = edgeOpacity(edge);
    const group = new THREE.Group();
    group.add(line, arrow);
    group.userData.edge = edge;
    group.userData.lineMaterial = material;
    group.userData.arrowMaterial = arrow.material;
    edgeRoot.add(group);
  }
}

function applyKindRotation(mesh, kind) {
  if (kind === "service" || kind === "class") {
    mesh.rotation.y = Math.PI / 6;
  } else if (kind === "protocol") {
    mesh.rotation.y = Math.PI / 4;
  }
}

function colorForNode(node) {
  if (node.kind === "file") return 0x252b31;
  return colors[node.kind] || 0x95a4ad;
}

function emissiveForNode(node) {
  if (node.kind === "file") return 0x05080a;
  return colors[node.kind] || 0x000000;
}

function draw() {
  applyCameraAnimation();
  if (!state.graph || state.layout.length === 0) {
    applyKeyboardNavigation();
    controls.update();
    renderer.render(scene, camera);
    return;
  }
  applyKeyboardNavigation();
  applyFilters();
  controls.update();
  renderer.render(scene, camera);
}

function applyFilters() {
  if (!state.graph) return;
  const neighborhood = focusedNeighborhood();
  resetDynamicLayout();
  root.children.forEach((object) => {
    const nodeId = object.userData.nodeId;
    if (!nodeId) return;
    const node = state.layout.find((candidate) => candidate.id === nodeId);
    const matched = isSearchMatch(node);
    const visible = isNodeVisible(node, neighborhood);
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
      object.material.wireframe = isOpenShell;
      object.material.opacity = dim ? 0.24 : 1;
      object.material.transparent = Boolean(dim);
      object.material.emissiveIntensity = nodeId === state.selectedId ? 0.45 : hovered ? 0.34 : matched ? 0.28 : node?.kind === "swiftui_view" ? 0.08 : 0.02;
    }
  });

  edgeRoot.visible = state.showEdges;
  edgeRoot.children.forEach((edgeObject) => {
    const edge = edgeObject.userData.edge;
    const matchesSelection = !state.selectedEdgesOnly || edge.from === state.selectedId || edge.to === state.selectedId;
    const visible = (!state.focusMode || neighborhood.has(edge.from) || neighborhood.has(edge.to))
      && isEdgeVisible(edge)
      && matchesSelection
      && root.children.some((object) => object.userData.nodeId === edge.from && object.visible)
      && root.children.some((object) => object.userData.nodeId === edge.to && object.visible);
    edgeObject.visible = visible;
    const opacity = edge.from === state.selectedId || edge.to === state.selectedId ? 1 : edgeOpacity(edge);
    edgeObject.userData.lineMaterial.opacity = opacity;
    edgeObject.userData.arrowMaterial.opacity = opacity;
  });
}

function bindEvents() {
  window.addEventListener("resize", resize);

  canvas.addEventListener("pointerdown", (event) => {
    state.pointerDown = { x: event.clientX, y: event.clientY };
    state.dragDistance = 0;
  });

  canvas.addEventListener("pointermove", (event) => {
    updateHoverFromPointer(event);
    if (!state.pointerDown) return;
    const deltaX = event.clientX - state.pointerDown.x;
    const deltaY = event.clientY - state.pointerDown.y;
    state.dragDistance = Math.max(state.dragDistance, Math.hypot(deltaX, deltaY));
  });

  canvas.addEventListener("pointerleave", () => {
    clearHover();
  });

  window.addEventListener("pointerup", () => {
    state.pointerDown = null;
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) return;
    event.preventDefault();
    state.pressedKeys.add(key);
  });

  window.addEventListener("keyup", (event) => {
    state.pressedKeys.delete(event.key.toLowerCase());
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
    const intersections = raycaster.intersectObjects([...root.children, ...popupRoot.children], true).filter((item) => nodeIdFromObject(item.object));
    const selectedNodeId = pickNodeIdFromIntersections(intersections);
    if (selectedNodeId) selectNode(selectedNodeId);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      state.query = "";
      searchInput.value = "";
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    state.query = searchInput.value.trim();
    const match = state.layout.find((node) => isSearchMatch(node));
    if (match) selectNode(match.id);
  });

  viewAllButton.addEventListener("click", () => {
    resetMapView();
  });

  focusButton.addEventListener("click", () => {
    state.focusMode = !state.focusMode;
    syncButtons();
  });

  edgesButton.addEventListener("click", () => {
    state.showEdges = !state.showEdges;
    syncButtons();
  });

  shareMapButton.addEventListener("click", async () => {
    await shareMapScreenshot();
  });

  mapPresetButtons.forEach((button) => {
    button.addEventListener("click", () => applyMapPreset(button.dataset.viewPreset));
  });

  parserSelect.addEventListener("change", async () => {
    state.parserMode = ["xcode-index", "merged", "swiftsyntax", "heuristic"].includes(parserSelect.value) ? parserSelect.value : "merged";
    localStorage.setItem(parserModeKey, state.parserMode);
    const lastProjectPath = localStorage.getItem(lastProjectPathKey);
    if (!lastProjectPath || state.graph?.project?.sourceRoot === "examples/SampleSwiftApp") {
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
  });

  showModulesToggle.addEventListener("change", () => {
    state.showModules = showModulesToggle.checked;
  });

  showPropertiesToggle.addEventListener("change", () => {
    state.showProperties = showPropertiesToggle.checked;
    buildMemberPopup();
  });

  selectedEdgesOnlyToggle.addEventListener("change", () => {
    state.selectedEdgesOnly = selectedEdgesOnlyToggle.checked;
  });

  performanceModeToggle.addEventListener("change", () => {
    state.performanceMode = performanceModeToggle.checked;
    renderer.setPixelRatio(state.performanceMode ? 1 : Math.min(window.devicePixelRatio, 2));
    buildScene();
    buildMemberPopup();
  });

  edgeDensitySelect.addEventListener("change", () => {
    state.edgeDensity = edgeDensitySelect.value;
    buildScene();
    buildMemberPopup();
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
      const node = state.graph.nodes.find((candidate) => candidate.id === sourceButton.dataset.sourceNodeId);
      if (!node) return;
      await showSourcePreview(node);
      return;
    }

    const xcodeButton = event.target.closest("[data-xcode-node-id]");
    if (xcodeButton) {
      const node = state.graph.nodes.find((candidate) => candidate.id === xcodeButton.dataset.xcodeNodeId);
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
        <span><code>${escapeHtml(edge.kind)}</code> ${edge.source ? `from <code>${escapeHtml(edge.source)}</code>` : ""}${edge.confidence ? ` · confidence <code>${escapeHtml(edge.confidence)}</code>` : ""}</span>
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
  }, 900);
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
  if (state.pressedKeys.has("e")) movement.y += 1;
  if (state.pressedKeys.has("q")) movement.y -= 1;
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
  state.openShellId = null;
  state.query = "";
  state.hoveredId = null;
  state.pressedKeys.clear();
  searchInput.value = "";
  clearHover();
  popupRoot.clear();
  state.cameraAnimation = null;
  state.popupFocusTarget = null;
  camera.position.copy(homeCameraPosition());
  controls.target.copy(defaultControlsTarget);
  controls.update();
  selectedDetails.innerHTML = `<p>Click any object in the map to inspect what it is, what it uses, and where it lives in source.</p>`;
  syncButtons();
}

function updateHoverFromPointer(event) {
  if (!state.graph || state.dragDistance > 6) return;
  const rect = canvas.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(state.pointer, camera);
  const intersections = raycaster.intersectObjects([...root.children, ...popupRoot.children], true)
    .filter((item) => nodeIdFromObject(item.object));
  const hoveredId = pickNodeIdFromIntersections(intersections);
  state.hoveredId = hoveredId;
  canvas.style.cursor = hoveredId ? "pointer" : "grab";

  if (!hoveredId) {
    clearHover();
    return;
  }

  const node = state.graph.nodes.find((candidate) => candidate.id === hoveredId);
  if (!node) {
    clearHover();
    return;
  }

  hoverTooltip.hidden = false;
  hoverTooltip.style.left = `${event.clientX - rect.left}px`;
  hoverTooltip.style.top = `${event.clientY - rect.top}px`;
  hoverTooltip.innerHTML = `
    <strong>${escapeHtml(node.name)}</strong>
    <span>${escapeHtml(friendlyKind(node.kind))}${node.file ? ` · ${escapeHtml(node.file)}:${node.line}` : ""}</span>
  `;
}

function clearHover() {
  state.hoveredId = null;
  canvas.style.cursor = "grab";
  hoverTooltip.hidden = true;
}

function applyMapPreset(preset) {
  state.focusMode = false;
  state.showEdges = true;
  state.selectedEdgesOnly = false;
  selectedEdgesOnlyToggle.checked = false;

  if (preset === "files") {
    state.showFiles = true;
    state.showModules = false;
    state.showProperties = false;
    state.edgeDensity = "clean";
  } else if (preset === "architecture") {
    state.showFiles = true;
    state.showModules = true;
    state.showProperties = true;
    state.edgeDensity = "normal";
  } else if (preset === "quiet") {
    state.showEdges = false;
    state.edgeDensity = "clean";
  } else {
    state.showFiles = true;
    state.showModules = true;
    state.showProperties = true;
    state.edgeDensity = "normal";
  }

  showFilesToggle.checked = state.showFiles;
  showModulesToggle.checked = state.showModules;
  showPropertiesToggle.checked = state.showProperties;
  edgeDensitySelect.value = state.edgeDensity;
  mapPresetButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewPreset === preset);
  });

  buildScene();
  buildMemberPopup();
  syncButtons();
}

function focusCameraOnNode(node) {
  const layoutNode = state.layout.find((candidate) => candidate.id === node?.id);
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
  const node = state.graph.nodes.find((candidate) => candidate.id === id);
  if (!node) return;
  state.openShellId = resolveOpenShellId(id);
  selectedDetails.innerHTML = renderDetails(node);
  buildMemberPopup();
  focusCameraOnNode(node);
}

function renderDetails(node) {
  const outgoing = state.graph.edges.filter((edge) => edge.from === node.id);
  const incoming = state.graph.edges.filter((edge) => edge.to === node.id);
  const kindMeaning = describeKind(node.kind);
  const memberIds = getInspectableMemberIds(node.id);
  const externalUses = getExternalUses(node);
  const ownedState = getOwnedState(node);
  const names = (edges, direction) => edges
    .slice(0, 6)
    .map((edge) => {
      const otherId = direction === "out" ? edge.to : edge.from;
      const other = state.graph.nodes.find((candidate) => candidate.id === otherId);
      return `<code>${edge.kind}</code> ${escapeHtml(other?.name || otherId)}`;
    })
    .join("<br>");

  return `
    <div class="detail-card">
      <div class="detail-title">
        <h3>${escapeHtml(node.name)}</h3>
        <span class="detail-badge">${escapeHtml(friendlyKind(node.kind))}</span>
      </div>
      <p>${escapeHtml(kindMeaning)}${node.file ? ` · <code>${escapeHtml(node.file)}:${node.line}</code>` : ""}</p>
    </div>
    ${node.source ? `<p>Found by <code>${escapeHtml(node.source)}</code>${node.inferred ? " · inferred hint" : ""}${node.indexResolved ? " · Xcode index resolved" : ""}${node.confidence ? ` · confidence <code>${escapeHtml(node.confidence)}</code>` : ""}</p>` : ""}
    ${node.file ? `<div class="source-actions"><button class="button" type="button" data-source-node-id="${escapeHtml(node.id)}">Source</button><button class="button" type="button" data-xcode-node-id="${escapeHtml(node.id)}">Open in Xcode</button></div><div id="sourcePreview" class="source-preview"></div>` : ""}
    <div class="detail-grid">
      <p><strong>Complexity</strong><br><code>${escapeHtml(JSON.stringify(node.metrics || {}))}</code></p>
      <p><strong>Inside this object</strong><br>${memberIds.length > 0 ? `${memberIds.length} functions / properties in the 3D popup.` : "No inspectable members yet."}</p>
      ${ownedState.length > 0 ? `<p><strong>State it owns</strong><br>${names(ownedState, "out")}</p>` : ""}
      ${node.kind === "function" ? `<p><strong>Uses outside parent</strong><br>${names(externalUses, "out") || "No external type usage detected."}</p>` : ""}
      <p><strong>Uses</strong><br>${names(outgoing.filter((edge) => edge.kind !== "owns_state"), "out") || "No outgoing relationships yet."}</p>
      <p><strong>Used by</strong><br>${names(incoming, "in") || "No incoming relationships yet."}</p>
    </div>
  `;
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
        line: node.line
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

function renderSourceSnippet(payload) {
  const rows = payload.code.map((line) => {
    const isTarget = line.number === payload.line;
    return `<span class="${isTarget ? "is-target" : ""}"><b>${line.number}</b>${escapeHtml(line.content || " ")}</span>`;
  }).join("");

  return `
    <p><strong>${escapeHtml(payload.file)}:${payload.line}</strong></p>
    <pre>${rows}</pre>
  `;
}

function getExternalUses(node) {
  if (node.kind !== "function") return [];
  const parentId = state.graph.edges.find((edge) => edge.kind === "defines" && edge.to === node.id)?.from;
  return state.graph.edges.filter((edge) => edge.kind === "uses" && edge.from === node.id && edge.to !== parentId);
}

function getOwnedState(node) {
  return state.graph.edges.filter((edge) => edge.kind === "owns_state" && edge.from === node.id);
}

function focusedNeighborhood() {
  if (!state.graph || !state.selectedId) {
    return new Set();
  }
  const neighborhood = new Set([state.selectedId]);
  if (state.openShellId) {
    neighborhood.add(state.openShellId);
    getInspectableMemberIds(state.openShellId).forEach((memberId) => neighborhood.add(memberId));
  }
  for (const edge of state.graph.edges) {
    if (edge.from === state.selectedId) neighborhood.add(edge.to);
    if (edge.to === state.selectedId) neighborhood.add(edge.from);
  }
  return neighborhood;
}

function isNodeVisible(node, neighborhood) {
  if (!node) return false;
  if (!state.showFiles && node.kind === "file") return false;
  if (!state.showModules && node.kind === "module") return false;
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
  projectMeta.textContent = `${descriptor} · ${new Date(graph.project.scannedAt).toLocaleString()} · ${graph.nodes.length} items`;
  document.querySelector("#nodeCount").textContent = graph.nodes.length;
  document.querySelector("#edgeCount").textContent = graph.edges.length;
  document.querySelector("#viewCount").textContent = graph.nodes.filter((node) => node.kind === "swiftui_view").length;
  document.querySelector("#serviceCount").textContent = graph.nodes.filter((node) => node.kind === "service" || node.kind === "class").length;
}

function syncButtons() {
  focusButton.classList.toggle("is-active", state.focusMode);
  edgesButton.classList.toggle("is-active", state.showEdges);
  viewAllButton.classList.toggle("is-active", !state.focusMode);
  if (!state.showEdges) {
    mapPresetButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.viewPreset === "quiet"));
  }
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
  const width = clamp((node.width || 54) * 0.28, 14, 26);
  const depth = clamp((node.depth || 40) * 0.38, 12, 22);
  const thickness = 0.9;
  const baseMaterial = getStandardMaterial("file-marker-base", {
    color: 0x9fb0ba,
    roughness: 0.5,
    metalness: 0.04,
    emissive: 0x1f3038,
    emissiveIntensity: 0.08
  });
  const foldMaterial = getStandardMaterial("file-marker-fold", {
    color: 0x8fb8ca,
    roughness: 0.55,
    metalness: 0.04
  });
  const lineMaterial = getStandardMaterial("file-marker-lines", {
    color: 0x20323c,
    roughness: 0.7,
    metalness: 0.02
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

function childPositionOnFilePlane(index, total, fileNode) {
  if (!fileNode) return gridPosition(index, total, 66, 58);
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const usableWidth = Math.max(42, fileNode.width * 0.72);
  const usableDepth = Math.max(36, fileNode.depth * 0.68);
  return {
    x: (column - (columns - 1) / 2) * (usableWidth / columns),
    z: (row - (rows - 1) / 2) * (usableDepth / rows)
  };
}

function dimensionsForNode(node) {
  if (node.kind === "file") {
    const lines = node.metrics?.lines || 30;
    const areaScale = clamp(Math.sqrt(lines / 60), 0.85, 3.2);
    return {
      width: Math.round(86 * areaScale),
      depth: Math.round(58 * areaScale),
      height: 3
    };
  }

  const complexity = complexityForNode(node);
  const volumeScale = Math.cbrt(complexity);
  const base = baseDimensionsForKind(node.kind);
  return {
    width: Math.round(base.width * volumeScale),
    depth: Math.round(base.depth * volumeScale),
    height: Math.round(base.height * volumeScale)
  };
}

function complexityForNode(node) {
  if (node.kind === "file") return 1;
  if (node.kind === "function") return 1.2;
  if (node.kind === "property") return 0.75;
  if (node.kind === "module") return 0.85;
  if (node.kind === "repository") return 2.2;

  const methodWeight = (node.metrics?.methods || 0) * 0.8;
  const propertyWeight = (node.metrics?.properties || 0) * 0.45;
  const kindWeight = node.kind === "swiftui_view" ? 1.35 : 1;
  return clamp((1 + methodWeight + propertyWeight) * kindWeight, 0.9, 6);
}

function baseDimensionsForKind(kind) {
  if (kind === "repository") return { width: 72, depth: 72, height: 34 };
  if (kind === "file") return { width: 72, depth: 48, height: 3 };
  if (kind === "swiftui_view") return { width: 34, depth: 34, height: 34 };
  if (kind === "service" || kind === "class") return { width: 32, depth: 32, height: 52 };
  if (kind === "function") return { width: 10, depth: 10, height: 10 };
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
  } else if (kind === "service" || kind === "class") {
    const radius = Math.max(8, Math.min(roundedWidth, roundedDepth) / 2);
    geometry = new THREE.CylinderGeometry(radius * 0.74, radius, roundedHeight, 6);
  } else if (kind === "file") {
    geometry = new THREE.BoxGeometry(roundedWidth, roundedHeight, roundedDepth);
  } else if (kind === "function" || kind === "protocol") {
    const radius = Math.max(4, Math.min(roundedWidth, roundedDepth) / 2);
    geometry = new THREE.CylinderGeometry(radius, radius, roundedHeight, kind === "protocol" ? 8 : 14);
  } else if (kind === "property") {
    const radius = Math.max(4, Math.cbrt(roundedWidth * roundedHeight * roundedDepth) / 2);
    geometry = new THREE.SphereGeometry(radius, 14, 10);
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
  if (kind === "property") return "stored or computed property";
  return "code structure";
}

function friendlyKind(kind) {
  if (kind === "swiftui_view") return "View";
  if (kind === "repository") return "App";
  if (kind === "module") return "Module";
  if (kind === "service") return "Service";
  if (kind === "function") return "Function";
  if (kind === "property") return "State";
  return kind.replaceAll("_", " ");
}

function getInspectableMemberIds(nodeId) {
  if (!state.graph) return [];
  return state.graph.edges
    .filter((edge) => edge.kind === "defines" && edge.from === nodeId)
    .map((edge) => edge.to)
    .filter((memberId) => {
      const node = state.graph.nodes.find((candidate) => candidate.id === memberId);
      return node?.kind === "function" || node?.kind === "property";
    });
}

function isOpenedShell(nodeId) {
  return nodeId === state.openShellId && getInspectableMemberIds(nodeId).length > 0;
}

function resolveOpenShellId(nodeId) {
  const memberIds = getInspectableMemberIds(nodeId);
  if (memberIds.length > 0) return nodeId;

  const node = state.graph?.nodes.find((candidate) => candidate.id === nodeId);
  if (node?.kind === "function" || node?.kind === "property") {
    return state.graph.edges.find((edge) => edge.kind === "defines" && edge.to === nodeId)?.from || null;
  }

  return null;
}

function pickNodeIdFromIntersections(intersections) {
  if (intersections.length === 0) return null;

  const preferred = intersections.find((item) => !isOpenedShell(nodeIdFromObject(item.object)));
  return nodeIdFromObject((preferred || intersections[0]).object);
}

function nodeIdFromObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.nodeId) return current.userData.nodeId;
    current = current.parent;
  }
  return null;
}

function shouldShowLabel(nodeId) {
  const node = state.graph?.nodes.find((candidate) => candidate.id === nodeId);
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
  const node = state.graph?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return false;
  if (node.kind === "function" || node.kind === "property") return false;
  return true;
}

function resetDynamicLayout() {
  for (const mesh of state.meshById.values()) {
    mesh.position.copy(mesh.userData.defaultPosition);
    mesh.scale.copy(mesh.userData.defaultScale);
    if (mesh.material) {
      mesh.material.wireframe = mesh.userData.defaultWireframe;
    }
  }
  for (const label of state.labelById.values()) {
    label.position.copy(label.userData.defaultPosition);
  }
}

function buildMemberPopup() {
  popupRoot.clear();
  state.popupFocusTarget = null;

  const memberIds = getInspectableMemberIds(state.openShellId);
  if (memberIds.length === 0) return;

  const shellNode = state.layout.find((candidate) => candidate.id === state.openShellId);
  if (!shellNode) return;

  const visibleMemberIds = memberIds.filter((memberId) => {
    const member = state.graph.nodes.find((candidate) => candidate.id === memberId);
    return member?.kind !== "property" || state.showProperties;
  });
  if (visibleMemberIds.length === 0) return;

  const shellTop = (shellNode.y || 0) + shellNode.height;
  const origin = new THREE.Vector3(shellNode.x + 160 + shellNode.width, shellTop + 210, shellNode.z);
  const dependencyIds = getPopupDependencyIds(shellNode.id, visibleMemberIds);
  const popupNodeCount = visibleMemberIds.length + dependencyIds.length + 1;
  const columns = Math.max(2, Math.ceil(Math.sqrt(popupNodeCount)));
  const rows = Math.max(1, Math.ceil(popupNodeCount / columns));
  const frameWidth = Math.max(210, columns * 74);
  const frameHeight = 170;
  const frameDepth = Math.max(160, rows * 72);
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

  const floor = new THREE.GridHelper(floorSize, Math.max(columns, rows) * 2, 0x2a6074, 0x15303b);
  floor.position.set(origin.x, origin.y - frameHeight / 2 + 4, origin.z);
  popupRoot.add(floor);

  const title = makeLabel(`Inspecting ${shellNode.name}`, "#dff6ff", 104, 12);
  title.position.set(origin.x, origin.y + frameHeight / 2 + 18, origin.z);
  popupRoot.add(title);

  const positions = new Map();
  const parentPosition = new THREE.Vector3(origin.x, origin.y - frameHeight / 2 + 24, origin.z);
  const parentMesh = new THREE.Mesh(
    makeNodeGeometry(shellNode.kind, Math.max(28, shellNode.width * 0.38), Math.max(18, shellNode.height * 0.38), Math.max(28, shellNode.depth * 0.38)),
    getNodeMaterial(shellNode.kind, "popup-parent", {
      color: colors[shellNode.kind] || 0x95a4ad,
      roughness: 0.56,
      metalness: 0.12,
      emissive: colors[shellNode.kind] || 0x000000,
      emissiveIntensity: 0.12
    })
  );
  parentMesh.position.copy(parentPosition);
  parentMesh.userData.nodeId = shellNode.id;
  popupRoot.add(parentMesh);
  positions.set(shellNode.id, parentPosition.clone());
  const parentLabel = makeLabel(shellNode.name, "#e6fbff", 66, 10);
  parentLabel.position.set(parentPosition.x, parentPosition.y + Math.max(14, shellNode.height * 0.2 + 14), parentPosition.z);
  popupRoot.add(parentLabel);

  placePopupMembers(visibleMemberIds, origin, columns, frameHeight, positions);
  placePopupDependencies(dependencyIds, origin, columns, frameHeight, positions);

  getPopupEdges(shellNode.id, visibleMemberIds, dependencyIds).forEach((edge) => drawPopupEdge(edge, positions));
}

function placePopupMembers(memberIds, origin, columns, frameHeight, positions) {
  memberIds.forEach((memberId, index) => {
    const node = state.layout.find((candidate) => candidate.id === memberId);
    if (!node) return;
    const base = gridPosition(index, Math.max(1, memberIds.length), 70, 64);
    const layerY = node.kind === "function" ? 42 : 12;
    const position = new THREE.Vector3(
      origin.x + base.x,
      origin.y - frameHeight / 2 + layerY + node.height,
      origin.z + base.z
    );
    const material = getNodeMaterial(node.kind, "popup-member", {
      color: colors[node.kind] || 0x95a4ad,
      roughness: 0.56,
      metalness: 0.1,
      emissive: colors[node.kind] || 0x000000,
      emissiveIntensity: 0.08
    });
    const sizeBoost = node.kind === "function" ? 1.9 : 1.55;
    const boxWidth = Math.max(12, node.width * sizeBoost);
    const boxHeight = Math.max(10, node.height * sizeBoost);
    const boxDepth = Math.max(12, node.depth * sizeBoost);
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

function placePopupDependencies(dependencyIds, origin, columns, frameHeight, positions) {
  dependencyIds.forEach((dependencyId, index) => {
    const node = state.layout.find((candidate) => candidate.id === dependencyId) || state.graph.nodes.find((candidate) => candidate.id === dependencyId);
    if (!node) return;
    const base = gridPosition(index, Math.max(1, dependencyIds.length), 74, 68, 0, -28);
    const position = new THREE.Vector3(
      origin.x + base.x,
      origin.y - frameHeight / 2 + 92 + (index % 2) * 18,
      origin.z + base.z
    );
    const material = getNodeMaterial(node.kind, "popup-dependency", {
      color: colors[node.kind] || 0xa7c4ff,
      roughness: 0.62,
      metalness: 0.08,
      emissive: colors[node.kind] || 0xa7c4ff,
      emissiveIntensity: 0.06
    });
    const boxWidth = Math.max(16, (node.width || 24) * 0.85);
    const boxHeight = Math.max(12, (node.height || 18) * 0.85);
    const boxDepth = Math.max(16, (node.depth || 24) * 0.85);
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

function getPopupDependencyIds(parentId, memberIds) {
  const memberSet = new Set(memberIds);
  return uniqueValues(state.graph.edges
    .filter((edge) => edge.from === parentId && ["uses", "conforms_to"].includes(edge.kind))
    .map((edge) => edge.to)
    .filter((nodeId) => nodeId !== parentId && !memberSet.has(nodeId)));
}

function getPopupEdges(parentId, memberIds, dependencyIds) {
  const visibleIds = new Set([parentId, ...memberIds, ...dependencyIds]);
  const edges = [];

  state.graph.edges.forEach((edge) => {
    if (!isEdgeVisible(edge)) return;
    if (edge.kind === "defines" && edge.from === parentId && visibleIds.has(edge.to)) edges.push(edge);
    if (edge.kind === "owns_state" && edge.from === parentId && visibleIds.has(edge.to)) edges.push(edge);
    if (["uses", "conforms_to"].includes(edge.kind) && edge.from === parentId && visibleIds.has(edge.to)) edges.push(edge);
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
  const curve = new THREE.QuadraticBezierCurve3(
    fromPosition,
    new THREE.Vector3((fromPosition.x + toPosition.x) / 2, Math.max(fromPosition.y, toPosition.y) + popupEdgeLift(edge.kind), (fromPosition.z + toPosition.z) / 2),
    toPosition
  );
  const points = curve.getPoints(12);
  const color = popupEdgeColor(edge.kind);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: popupEdgeOpacity(edge.kind) });
  const line = new THREE.Line(geometry, material);
  const arrow = makeArrowHead(points, color);
  arrow.material.opacity = popupEdgeOpacity(edge.kind);
  popupRoot.add(line, arrow);
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
