import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.querySelector("#worldCanvas");
const searchInput = document.querySelector("#searchInput");
const selectedDetails = document.querySelector("#selectedDetails");
const viewAllButton = document.querySelector("#viewAllButton");
const focusButton = document.querySelector("#focusButton");
const edgesButton = document.querySelector("#edgesButton");
const pickProjectButton = document.querySelector("#pickProjectButton");
const loadSampleButton = document.querySelector("#loadSampleButton");
const showFilesToggle = document.querySelector("#showFilesToggle");
const showModulesToggle = document.querySelector("#showModulesToggle");
const showPropertiesToggle = document.querySelector("#showPropertiesToggle");
const selectedEdgesOnlyToggle = document.querySelector("#selectedEdgesOnlyToggle");
const projectName = document.querySelector("#projectName");
const projectMeta = document.querySelector("#projectMeta");
const pickerStatus = document.querySelector("#pickerStatus");
const scanSummary = document.querySelector("#scanSummary");

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

const importantKinds = new Set(["file", "swiftui_view", "service", "class", "model", "struct", "enum", "protocol"]);

const state = {
  graph: null,
  layout: [],
  selectedId: null,
  openShellId: null,
  query: "",
  showEdges: true,
  selectedEdgesOnly: false,
  focusMode: false,
  showFiles: true,
  showModules: true,
  showProperties: true,
  pressedKeys: new Set(),
  pointer: new THREE.Vector2(),
  pointerDown: null,
  dragDistance: 0,
  meshById: new Map(),
  labelById: new Map()
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1218);
scene.fog = new THREE.Fog(0x0a1218, 2600, 6200);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 3000);
const defaultCameraPosition = new THREE.Vector3(0, 530, 760);
const defaultControlsTarget = new THREE.Vector3(0, 120, 0);
camera.position.copy(defaultCameraPosition);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
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
controls.maxDistance = 1800;
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
  bindEvents();
  resize();
  await loadSampleUniverse();
  renderer.setAnimationLoop(draw);
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
    body: "{}"
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Project scan failed.");
  }

  loadGraph(payload.graph, "Native Xcode scan");
  pickerStatus.textContent = `Loaded ${payload.graph.project.name}.`;
  scanSummary.textContent = `${payload.diagnostics.swiftFileCount} Swift files · ${payload.diagnostics.typeCount} types · source root ${payload.diagnostics.sourceRoot}`;
}

function loadGraph(graph, descriptor) {
  state.graph = graph;
  state.layout = buildLayout(graph);
  state.selectedId = null;
  state.openShellId = null;
  state.query = "";
  state.meshById = new Map();
  state.labelById = new Map();
  searchInput.value = "";
  updateStats(graph, descriptor);
  buildScene();
  selectNode(state.layout.find((item) => item.kind === "repository")?.id || state.layout[0]?.id);
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
      ...gridPosition(index, Math.max(1, files.length), 190, 165, 0, 20),
      y: 0,
      ...dimensionsForNode(file)
    });
  });

  types.forEach((type) => {
    const fileEdge = graph.edges.find((edge) => edge.kind === "defines" && edge.to === type.id);
    const parent = layout.find((item) => item.id === fileEdge?.from);
    const siblings = types.filter((candidate) => graph.edges.some((edge) => edge.kind === "defines" && edge.from === fileEdge?.from && edge.to === candidate.id));
    const siblingIndex = siblings.findIndex((candidate) => candidate.id === type.id);
    const offset = gridPosition(siblingIndex, Math.max(1, siblings.length), 66, 58);
    layout.push({
      ...type,
      x: (parent?.x || 0) + offset.x,
      z: (parent?.z || 0) + offset.z,
      y: (parent?.y || 0) + (parent?.height || 0) + 44,
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
    const material = new THREE.MeshStandardMaterial({
      color: colors[node.kind] || 0x95a4ad,
      roughness: 0.64,
      metalness: node.kind === "swiftui_view" ? 0.24 : 0.12,
      emissive: colors[node.kind] || 0x000000,
      emissiveIntensity: node.kind === "swiftui_view" ? 0.08 : 0.02
    });
    const geometry = makeNodeGeometry(node.kind, node.width, node.height, node.depth);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(node.x, (node.y || 0) + node.height / 2, node.z);
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

    if (importantKinds.has(node.kind) || node.kind === "function" || node.kind === "property") {
      const label = makeLabel(
        node.name,
        node.kind === "swiftui_view" ? "#dfffee" : node.kind === "function" || node.kind === "property" ? "#f2f6f8" : "#d9e7ee",
        node.kind === "function" || node.kind === "property" ? 66 : 92,
        node.kind === "function" || node.kind === "property" ? 14 : 18
      );
      label.position.set(node.x, (node.y || 0) + node.height + 24, node.z);
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
    if (!["uses", "imports", "conforms_to"].includes(edge.kind)) continue;
    const from = state.layout.find((node) => node.id === edge.from);
    const to = state.layout.find((node) => node.id === edge.to);
    if (!from || !to) continue;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(from.x, (from.y || 0) + from.height + 10, from.z),
      new THREE.Vector3((from.x + to.x) / 2, Math.max(from.height, to.height) + 92, (from.z + to.z) / 2),
      new THREE.Vector3(to.x, (to.y || 0) + to.height + 10, to.z)
    );
    const color = edgeColor(edge.kind);
    const points = curve.getPoints(24);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.58 });
    const line = new THREE.Line(geometry, material);
    const arrow = makeArrowHead(points, color);
    const group = new THREE.Group();
    group.add(line, arrow);
    group.userData.edge = edge;
    group.userData.lineMaterial = material;
    group.userData.arrowMaterial = arrow.material;
    edgeRoot.add(group);
  }
}

function draw() {
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
    const matched = state.query && node?.name.toLowerCase().includes(state.query.toLowerCase());
    const visible = isNodeVisible(node, neighborhood);
    if (object.type === "Sprite") {
      object.visible = visible && shouldShowLabel(nodeId);
      return;
    }
    object.visible = visible && shouldShowMesh(nodeId);
    const dim = state.query && !matched && nodeId !== state.selectedId;
    if (object.material) {
      const isOpenShell = isOpenedShell(nodeId);
      object.material.wireframe = isOpenShell;
      object.material.opacity = dim ? 0.24 : 1;
      object.material.transparent = Boolean(dim);
      object.material.emissiveIntensity = nodeId === state.selectedId ? 0.45 : matched ? 0.28 : node?.kind === "swiftui_view" ? 0.08 : 0.02;
    }
  });

  edgeRoot.visible = state.showEdges;
  edgeRoot.children.forEach((edgeObject) => {
    const edge = edgeObject.userData.edge;
    const matchesSelection = !state.selectedEdgesOnly || edge.from === state.selectedId || edge.to === state.selectedId;
    const visible = (!state.focusMode || neighborhood.has(edge.from) || neighborhood.has(edge.to))
      && matchesSelection
      && root.children.some((object) => object.userData.nodeId === edge.from && object.visible)
      && root.children.some((object) => object.userData.nodeId === edge.to && object.visible);
    edgeObject.visible = visible;
    const opacity = edge.from === state.selectedId || edge.to === state.selectedId ? 1 : 0.58;
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
    if (!state.pointerDown) return;
    const deltaX = event.clientX - state.pointerDown.x;
    const deltaY = event.clientY - state.pointerDown.y;
    state.dragDistance = Math.max(state.dragDistance, Math.hypot(deltaX, deltaY));
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

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim();
    const match = state.layout.find((node) => state.query && node.name.toLowerCase().includes(state.query.toLowerCase()));
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

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  controls.update();
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
  movement.normalize().multiplyScalar(speed);
  camera.position.add(movement);
  controls.target.add(movement);
}

function resetMapView() {
  state.focusMode = false;
  state.selectedId = null;
  state.openShellId = null;
  state.query = "";
  state.pressedKeys.clear();
  searchInput.value = "";
  popupRoot.clear();
  camera.position.copy(defaultCameraPosition);
  controls.target.copy(defaultControlsTarget);
  controls.update();
  selectedDetails.innerHTML = `<p>Select a tower, building, or road to inspect the code graph.</p>`;
  syncButtons();
}

function selectNode(id) {
  state.selectedId = id;
  const node = state.graph.nodes.find((candidate) => candidate.id === id);
  if (!node) return;
  state.openShellId = resolveOpenShellId(id);
  selectedDetails.innerHTML = renderDetails(node);
  buildMemberPopup();
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
    <p><strong>${escapeHtml(node.name)}</strong><br>${escapeHtml(node.kind)} · ${escapeHtml(kindMeaning)} ${node.file ? `in <code>${escapeHtml(node.file)}:${node.line}</code>` : ""}</p>
    ${node.file ? `<div class="source-actions"><button class="button" type="button" data-source-node-id="${escapeHtml(node.id)}">Source</button><button class="button" type="button" data-xcode-node-id="${escapeHtml(node.id)}">Open in Xcode</button></div><div id="sourcePreview" class="source-preview"></div>` : ""}
    <p>Metrics: <code>${escapeHtml(JSON.stringify(node.metrics || {}))}</code></p>
    <p><strong>Members</strong><br>${memberIds.length > 0 ? `${memberIds.length} functions / properties shown in the 3D inspector popup.` : "No inspectable members."}</p>
    ${ownedState.length > 0 ? `<p><strong>State properties</strong><br>${names(ownedState, "out")}</p>` : ""}
    ${node.kind === "function" ? `<p><strong>Outside parent</strong><br>${names(externalUses, "out") || "No external type usage detected."}</p>` : ""}
    <p><strong>Uses</strong><br>${names(outgoing.filter((edge) => edge.kind !== "owns_state"), "out") || "No outgoing relationships yet."}</p>
    <p><strong>Used by</strong><br>${names(incoming, "in") || "No incoming relationships yet."}</p>
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

function updateStats(graph, descriptor) {
  projectName.textContent = graph.project.name;
  projectMeta.textContent = `${descriptor} · ${new Date(graph.project.scannedAt).toLocaleString()} · ${graph.nodes.length} nodes`;
  document.querySelector("#nodeCount").textContent = graph.nodes.length;
  document.querySelector("#edgeCount").textContent = graph.edges.length;
  document.querySelector("#viewCount").textContent = graph.nodes.filter((node) => node.kind === "swiftui_view").length;
  document.querySelector("#serviceCount").textContent = graph.nodes.filter((node) => node.kind === "service" || node.kind === "class").length;
}

function syncButtons() {
  focusButton.classList.toggle("is-active", state.focusMode);
  edgesButton.classList.toggle("is-active", state.showEdges);
  viewAllButton.classList.toggle("is-active", !state.focusMode);
}

function makeLabel(text, color, width = 92, height = 18) {
  const labelCanvas = document.createElement("canvas");
  const labelContext = labelCanvas.getContext("2d");
  labelCanvas.width = 320;
  labelCanvas.height = 64;
  labelContext.font = "700 26px Inter, system-ui, sans-serif";
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

function dimensionsForNode(node) {
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
  if (node.kind === "file") return clamp((node.metrics?.lines || 30) / 35, 0.8, 5.2);
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
  if (kind === "file") return { width: 54, depth: 54, height: 34 };
  if (kind === "swiftui_view") return { width: 34, depth: 34, height: 34 };
  if (kind === "function") return { width: 10, depth: 10, height: 10 };
  if (kind === "property") return { width: 8, depth: 8, height: 8 };
  if (kind === "module") return { width: 34, depth: 34, height: 22 };
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
  if (kind === "function" || kind === "protocol") {
    const radius = Math.max(4, Math.min(roundedWidth, roundedDepth) / 2);
    geometry = new THREE.CylinderGeometry(radius, radius, roundedHeight, 14);
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
  if (kind === "uses") return 0x7cf1b8;
  if (kind === "imports") return 0x63d2ff;
  if (kind === "owns_state") return 0xff6b78;
  return 0xffffff;
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
  if (importantKinds.has(node.kind)) return true;
  if (node.kind === "function" || node.kind === "property") return false;
  return false;
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

  const title = makeLabel(`Inspecting ${shellNode.name}`, "#dff6ff", 150, 18);
  title.position.set(origin.x, origin.y + frameHeight / 2 + 24, origin.z);
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
  const parentLabel = makeLabel(shellNode.name, "#e6fbff", 88, 14);
  parentLabel.position.set(parentPosition.x, parentPosition.y + Math.max(18, shellNode.height * 0.2 + 18), parentPosition.z);
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

    const label = makeLabel(node.name, node.kind === "property" ? "#d7e3ea" : "#ffffff", 74, 14);
    label.position.set(position.x, position.y + boxHeight / 2 + 18, position.z);
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

    const label = makeLabel(node.name, "#dbeaff", 76, 14);
    label.position.set(position.x, position.y + boxHeight / 2 + 18, position.z);
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
    if (edge.kind === "defines" && edge.from === parentId && visibleIds.has(edge.to)) edges.push(edge);
    if (edge.kind === "owns_state" && edge.from === parentId && visibleIds.has(edge.to)) edges.push(edge);
    if (["uses", "conforms_to"].includes(edge.kind) && edge.from === parentId && visibleIds.has(edge.to)) edges.push(edge);
    if (edge.kind === "uses_member" && visibleIds.has(edge.from) && visibleIds.has(edge.to)) edges.push(edge);
  });

  return edges;
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
