self.onmessage = (event) => {
  try {
    const graph = event.data?.graph;
    if (!graph) throw new Error("Missing graph.");
    self.postMessage({ layout: buildLayout(graph) });
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};

const fileChildGap = 4;

function buildLayout(graph) {
  const files = graph.nodes.filter((node) => node.kind === "file");
  const types = graph.nodes.filter((node) => !["repository", "file", "module", "function", "property"].includes(node.kind));
  const functions = graph.nodes.filter((node) => node.kind === "function" || node.kind === "property");
  const modules = graph.nodes.filter((node) => node.kind === "module");
  const edgesByFrom = groupEdgesByFrom(graph.edges);
  const definesByFrom = groupEdgesByFrom(graph.edges, "defines");
  const layout = [];
  const layoutById = new Map();
  const fileChildTypesById = mapFileChildTypes(files, types, definesByFrom);
  const fileDistricts = packFileDistricts(files, fileChildTypesById, edgesByFrom, graph.nodes);

  addLayoutNode(layout, layoutById, {
    ...graph.nodes.find((node) => node.kind === "repository"),
    ...gridPosition(0, 1, 170, 150, 0, -150),
    y: 0,
    ...dimensionsForNode({ kind: "repository" }, edgesByFrom, graph.nodes)
  });

  files.forEach((file, index) => {
    const dimensions = dimensionsForNode(file, edgesByFrom, graph.nodes);
    const district = fileDistricts.get(file.id) || {
      ...fileDistrictDimensions(file, fileChildTypesById.get(file.id) || [], edgesByFrom, graph.nodes),
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
      const offset = childPositionOnFilePlane(siblingIndex, Math.max(1, childTypes.length), parent, childTypes, edgesByFrom, graph.nodes);
      const dimensions = dimensionsForNode(type, edgesByFrom, graph.nodes);
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
      const spacing = spacingForNodes(orphanTypes, edgesByFrom, graph.nodes, 78, 68, 24);
      const position = gridPosition(index, Math.max(1, orphanTypes.length), spacing.x, spacing.z, 0, 210);
      addLayoutNode(layout, layoutById, {
        ...type,
        ...position,
        y: 48,
        ...dimensionsForNode(type, edgesByFrom, graph.nodes)
      });
    });

  const fileBounds = boundsForLayout(layout.filter((item) => item.kind === "file"));
  const moduleOriginZ = fileBounds.minZ - 85;
  modules.forEach((moduleNode, index) => {
    addLayoutNode(layout, layoutById, {
      ...moduleNode,
      ...gridPosition(index, Math.max(1, modules.length), 92, 76, 0, moduleOriginZ),
      y: 72,
      ...dimensionsForNode(moduleNode, edgesByFrom, graph.nodes)
    });
  });

  types.forEach((type) => {
    const parent = layoutById.get(type.id);
    if (!parent) return;
    const memberIds = new Set((definesByFrom.get(type.id) || []).map((edge) => edge.to));
    const members = functions.filter((candidate) => memberIds.has(candidate.id));
    const spacing = spacingForNodes(members, edgesByFrom, graph.nodes, 24, 24, 12);
    members.forEach((node, index) => {
      const dimensions = dimensionsForNode(node, edgesByFrom, graph.nodes);
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

function packFileDistricts(files, fileChildTypesById, edgesByFrom, allNodes) {
  if (files.length === 0) return new Map();
  const gap = 18;
  const districts = files.map((file) => ({
    file,
    ...fileDistrictDimensions(file, fileChildTypesById.get(file.id) || [], edgesByFrom, allNodes)
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

function fileDistrictDimensions(file, childTypes, edgesByFrom, allNodes) {
  const fileDimensions = dimensionsForNode(file, edgesByFrom, allNodes);
  if (childTypes.length === 0) {
    return { width: fileDimensions.width, depth: fileDimensions.depth };
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(childTypes.length)));
  const rows = Math.max(1, Math.ceil(childTypes.length / columns));
  const spacing = spacingForNodes(childTypes, edgesByFrom, allNodes, 38, 36, fileChildGap);
  const childDimensions = childTypes.map((type) => dimensionsForNode(type, edgesByFrom, allNodes));
  const maxChildWidth = childDimensions.reduce((value, item) => Math.max(value, item.width || 0), 0);
  const maxChildDepth = childDimensions.reduce((value, item) => Math.max(value, item.depth || 0), 0);
  return {
    width: Math.max(fileDimensions.width, spacing.x * Math.max(1, columns - 1) + maxChildWidth + fileChildGap * 2),
    depth: Math.max(fileDimensions.depth, spacing.z * Math.max(1, rows - 1) + maxChildDepth + fileChildGap * 2)
  };
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

function childPositionOnFilePlane(index, total, fileNode, childNodes, edgesByFrom, nodes) {
  if (!fileNode) return gridPosition(index, total, 66, 58);
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const spacing = spacingForNodes(childNodes, edgesByFrom, nodes, 38, 36, fileChildGap);
  const districtWidth = fileNode.visualWidth || fileNode.width;
  const districtDepth = fileNode.visualDepth || fileNode.depth;
  const usableWidth = Math.max(districtWidth * 0.25, spacing.x * Math.max(1, columns - 1));
  const usableDepth = Math.max(districtDepth * 0.25, spacing.z * Math.max(1, rows - 1));
  return {
    x: (column - (columns - 1) / 2) * Math.max(spacing.x, usableWidth / Math.max(1, columns)),
    z: (row - (rows - 1) / 2) * Math.max(spacing.z, usableDepth / Math.max(1, rows))
  };
}

function spacingForNodes(nodes, edgesByFrom, allNodes, minimumX, minimumZ, padding = 18) {
  const dimensions = nodes.map((node) => dimensionsForNode(node, edgesByFrom, allNodes));
  const maxWidth = dimensions.reduce((value, item) => Math.max(value, item.width || 0), 0);
  const maxDepth = dimensions.reduce((value, item) => Math.max(value, item.depth || 0), 0);
  const sizePadding = Math.max(padding, Math.max(maxWidth, maxDepth) * 0.18);
  return {
    x: Math.max(minimumX, maxWidth + sizePadding),
    z: Math.max(minimumZ, maxDepth + sizePadding)
  };
}

function boundsForLayout(items) {
  if (items.length === 0) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
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

function dimensionsForNode(node, edgesByFrom, allNodes) {
  const base = baseDimensionsForKind(node.kind);
  if (node.kind === "repository" || node.kind === "module") return base;
  const city = cityMetricsForNode(node, edgesByFrom, allNodes);
  if (node.kind === "file") {
    const footprint = clamp(44 + Math.sqrt(city.loc) * 8.5, 44, 420);
    return { width: Math.round(footprint), height: 3, depth: Math.round(Math.max(28, footprint * 0.7)) };
  }
  if (node.kind === "property") {
    const diameter = clamp(10 + Math.sqrt(city.volumeScore) * 1.8, 10, 58);
    return { width: Math.round(diameter), height: Math.round(diameter), depth: Math.round(diameter) };
  }
  const width = clamp(base.width * 0.55 + city.widthScore * 4.2, base.width * 0.75, 170);
  const height = clamp(base.height * 0.55 + city.heightScore * 2.4, base.height * 0.85, 440);
  const depth = clamp(base.depth * 0.55 + city.depthScore * 4.2, base.depth * 0.75, 170);
  return { width: Math.round(width), height: Math.round(height), depth: Math.round(depth) };
}

function cityMetricsForNode(node, edgesByFrom, allNodes) {
  const axis = axisMetricsForNode(node, edgesByFrom, allNodes);
  const complexity = complexityForNode(node, edgesByFrom);
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

function axisMetricsForNode(node, edgesByFrom, allNodes) {
  const metrics = node.metrics || {};
  const definedMemberIds = (edgesByFrom.get(node.id) || []).filter((edge) => edge.kind === "defines").map((edge) => edge.to);
  const nodeById = new Map(allNodes.map((item) => [item.id, item]));
  const definedMembers = definedMemberIds.map((id) => nodeById.get(id)).filter(Boolean);
  const definedFunctions = definedMembers.filter((member) => member.kind === "function").length;
  const definedProperties = definedMembers.filter((member) => member.kind === "property").length;
  const memberLines = definedMembers.reduce((sum, member) => sum + (member.metrics?.lines || 1), 0);
  const fileLines = allNodes.find((candidate) => candidate.kind === "file" && candidate.file === node.file)?.metrics?.lines || 0;
  const edgeCounts = graphEdgeCountsForNode(node.id, edgesByFrom);
  const variables = Math.max(node.kind === "property" ? 1 : 0, metrics.properties || 0, definedProperties, edgeCounts.ownedState || 0);
  const functions = Math.max(
    node.kind === "function" ? 1 : 0,
    metrics.methods || 0,
    definedFunctions,
    node.kind === "function" ? (metrics.calls || 0) + (metrics.branches || 0) * 2 : 0
  );
  const hasExplicitLines = Number.isFinite(metrics.lines) && metrics.lines > 0;
  let lines = hasExplicitLines ? metrics.lines : Math.max(1, memberLines || (node.kind === "file" ? fileLines || 30 : 8));
  if (!hasExplicitLines) lines = Math.max(lines, variables, functions);
  return { lines, variables, functions };
}

function complexityForNode(node, edgesByFrom) {
  if (node.kind === "file") return 1;
  const edgeCounts = graphEdgeCountsForNode(node.id, edgesByFrom);
  if (node.kind === "function") {
    const lineWeight = Math.sqrt(node.metrics?.lines || 2) * 0.42;
    const branchWeight = (node.metrics?.branches || 0) * 0.95;
    const callWeight = Math.sqrt(node.metrics?.calls || 0) * 0.5;
    const dependencyWeight = edgeCounts.outgoingUses * 0.8 + edgeCounts.memberUses * 0.65 + edgeCounts.incoming * 0.25;
    return clamp(0.9 + lineWeight + branchWeight + callWeight + dependencyWeight, 0.85, 18);
  }
  if (node.kind === "property") return clamp(0.72 + edgeCounts.incoming * 0.45 + edgeCounts.outgoingUses * 0.35, 0.65, 5);
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

function graphEdgeCountsForNode(nodeId, edgesByFrom) {
  const counts = { incoming: 0, outgoingUses: 0, memberUses: 0, definedMembers: 0, ownedState: 0 };
  for (const edges of edgesByFrom.values()) {
    for (const edge of edges) {
      if (edge.to === nodeId) counts.incoming += 1;
    }
  }
  return (edgesByFrom.get(nodeId) || []).reduce((counts, edge) => {
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
