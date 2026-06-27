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
  pointer: new THREE.Vector2(),
  pointerDown: null,
  dragDistance: 0,
  meshById: new Map(),
  labelById: new Map()
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b0f);
scene.fog = new THREE.Fog(0x070b0f, 850, 1700);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 3000);
camera.position.set(0, 530, 760);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

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
controls.target.set(0, 120, 0);
controls.update();

const universe = new THREE.Group();
const root = new THREE.Group();
const edgeRoot = new THREE.Group();
universe.add(root, edgeRoot);
scene.add(universe);

scene.add(new THREE.HemisphereLight(0xd8f6ff, 0x071018, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
keyLight.position.set(-320, 560, 260);
keyLight.castShadow = true;
scene.add(keyLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1300, 1300, 40, 40),
  new THREE.MeshStandardMaterial({ color: 0x081018, roughness: 0.92, metalness: 0.05 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(1300, 34, 0x263946, 0x14212a);
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

  layout.push({ ...graph.nodes.find((node) => node.kind === "repository"), x: 0, z: 0, width: 95, depth: 95, height: 24 });

  files.forEach((file, index) => {
    const position = radialPosition(index, Math.max(1, files.length), 245);
    layout.push({ ...file, ...position, width: 58, depth: 58, height: Math.max(36, Math.min(118, 26 + (file.metrics?.lines || 30) * 1.4)) });
  });

  types.forEach((type) => {
    const fileEdge = graph.edges.find((edge) => edge.kind === "defines" && edge.to === type.id);
    const parent = layout.find((item) => item.id === fileEdge?.from);
    const siblings = types.filter((candidate) => graph.edges.some((edge) => edge.kind === "defines" && edge.from === fileEdge?.from && edge.to === candidate.id));
    const siblingIndex = siblings.findIndex((candidate) => candidate.id === type.id);
    const offset = radialPosition(siblingIndex, Math.max(3, siblings.length), 66);
    layout.push({
      ...type,
      x: (parent?.x || 0) + offset.x,
      z: (parent?.z || 0) + offset.z,
      width: type.kind === "swiftui_view" ? 34 : 30,
      depth: type.kind === "swiftui_view" ? 34 : 30,
      height: 48 + (type.metrics?.methods || 0) * 18 + (type.metrics?.properties || 0) * 9 + (type.kind === "swiftui_view" ? 28 : 0)
    });
  });

  modules.forEach((moduleNode, index) => {
    const position = radialPosition(index, Math.max(1, modules.length), 390);
    layout.push({ ...moduleNode, ...position, width: 42, depth: 42, height: 20 });
  });

  functions.forEach((node, index) => {
    const edge = graph.edges.find((candidate) => candidate.kind === "defines" && candidate.to === node.id);
    const parent = layout.find((item) => item.id === edge?.from);
    if (!parent) return;
    const position = radialPosition(index, Math.max(8, functions.length), 22);
    layout.push({ ...node, x: parent.x + position.x, z: parent.z + position.z, y: parent.height + 8, width: 10, depth: 10, height: node.kind === "property" ? 8 : 12 });
  });

  return layout;
}

function buildScene() {
  root.clear();
  edgeRoot.clear();
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
    const geometry = new THREE.BoxGeometry(node.width, node.height, node.depth);
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
    controls.update();
    renderer.render(scene, camera);
    return;
  }
  applyFilters();
  controls.update();
  renderer.render(scene, camera);
}

function applyFilters() {
  if (!state.graph) return;
  const neighborhood = focusedNeighborhood();
  resetDynamicLayout();
  applyOpenBoxLayout();
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
    const intersections = raycaster.intersectObjects(root.children, false).filter((item) => item.object.userData.nodeId);
    const selectedNodeId = pickNodeIdFromIntersections(intersections);
    if (selectedNodeId) selectNode(selectedNodeId);
  });

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim();
    const match = state.layout.find((node) => state.query && node.name.toLowerCase().includes(state.query.toLowerCase()));
    if (match) selectNode(match.id);
  });

  viewAllButton.addEventListener("click", () => {
    state.focusMode = false;
    syncButtons();
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
  });

  selectedEdgesOnlyToggle.addEventListener("change", () => {
    state.selectedEdgesOnly = selectedEdgesOnlyToggle.checked;
  });

  selectedDetails.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-source-node-id]");
    if (!button) return;
    const node = state.graph.nodes.find((candidate) => candidate.id === button.dataset.sourceNodeId);
    if (!node) return;
    await showSourcePreview(node);
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

function selectNode(id) {
  state.selectedId = id;
  const node = state.graph.nodes.find((candidate) => candidate.id === id);
  if (!node) return;
  state.openShellId = resolveOpenShellId(id);
  selectedDetails.innerHTML = renderDetails(node);
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
    ${node.file ? `<button class="button source-button" type="button" data-source-node-id="${escapeHtml(node.id)}">Source</button><div id="sourcePreview" class="source-preview"></div>` : ""}
    <p>Metrics: <code>${escapeHtml(JSON.stringify(node.metrics || {}))}</code></p>
    <p><strong>Members</strong><br>${memberIds.length > 0 ? `${memberIds.length} functions / properties stacked inside on selection.` : "No stackable members."}</p>
    ${ownedState.length > 0 ? `<p><strong>State properties</strong><br>${names(ownedState, "out")}</p>` : ""}
    ${node.kind === "function" ? `<p><strong>Outside parent</strong><br>${names(externalUses, "out") || "No external type usage detected."}</p>` : ""}
    <p><strong>Uses</strong><br>${names(outgoing.filter((edge) => edge.kind !== "owns_state"), "out") || "No outgoing relationships yet."}</p>
    <p><strong>Used by</strong><br>${names(incoming, "in") || "No incoming relationships yet."}</p>
  `;
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

function radialPosition(index, total, radius) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
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
  const geometry = new THREE.ConeGeometry(4.5, 11, 14);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.58 });
  const arrow = new THREE.Mesh(geometry, material);
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

  const preferred = intersections.find((item) => !isOpenedShell(item.object.userData.nodeId));
  return (preferred || intersections[0]).object.userData.nodeId;
}

function shouldShowLabel(nodeId) {
  const node = state.graph?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return false;
  if (importantKinds.has(node.kind)) return true;
  if (!state.showProperties && node.kind === "property") return false;
  if (node.kind === "function" || node.kind === "property") {
    const parentId = state.graph.edges.find((edge) => edge.kind === "defines" && edge.to === nodeId)?.from;
    return parentId === state.openShellId;
  }
  return false;
}

function shouldShowMesh(nodeId) {
  const node = state.graph?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return false;
  if (!state.showProperties && node.kind === "property") return false;
  if (node.kind === "function" || node.kind === "property") {
    const parentId = state.graph.edges.find((edge) => edge.kind === "defines" && edge.to === nodeId)?.from;
    return parentId === state.openShellId;
  }
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

function applyOpenBoxLayout() {
  const memberIds = getInspectableMemberIds(state.openShellId);
  if (memberIds.length === 0) return;

  const shellNode = state.layout.find((candidate) => candidate.id === state.openShellId);
  if (!shellNode) return;

  const baseY = (shellNode.y || 0) + 14;
  const usableHeight = Math.max(20, shellNode.height - 24);
  const step = Math.min(18, usableHeight / Math.max(1, memberIds.length));

  memberIds.forEach((memberId, index) => {
    const mesh = state.meshById.get(memberId);
    const label = state.labelById.get(memberId);
    const node = state.layout.find((candidate) => candidate.id === memberId);
    if (!mesh || !node) return;

    const centeredOffset = index - (memberIds.length - 1) / 2;
    mesh.position.set(
      shellNode.x,
      baseY + index * step + node.height / 2,
      shellNode.z + centeredOffset * 4
    );
    mesh.scale.set(
      Math.max(1.8, (shellNode.width * 0.52) / node.width),
      1,
      Math.max(1.8, (shellNode.depth * 0.52) / node.depth)
    );

    if (label) {
      label.position.set(
        shellNode.x,
        baseY + index * step + node.height + 8,
        shellNode.z + centeredOffset * 4
      );
      label.visible = true;
    }
  });
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
