import Foundation
import SwiftParser
import SwiftSyntax

let excludedDirectoryNames: Set<String> = [
  ".build",
  ".git",
  "DerivedData",
  "build",
  "Build",
  "Pods",
  "Carthage",
  ".swiftpm",
  "SourcePackages",
  "Generated",
  "generated"
]

struct Graph: Encodable {
  let schemaVersion: Int
  let project: Project
  let nodes: [GraphNode]
  let edges: [GraphEdge]
}

struct Project: Encodable {
  let name: String
  let scannedAt: String
  let sourceRoot: String
}

struct GraphNode: Encodable {
  let id: String
  let kind: String
  let declarationKind: String?
  let name: String
  let file: String
  let line: Int
  let metrics: [String: Int]
}

struct GraphEdge: Encodable, Hashable {
  let from: String
  let to: String
  let kind: String
}

struct Diagnostics: Encodable {
  let swiftFileCount: Int
  let typeCount: Int
  let functionCount: Int
  let propertyCount: Int
}

struct ScanOutput: Encodable {
  let graph: Graph
  let diagnostics: Diagnostics
}

struct TypeContext {
  let id: String
  let name: String
  let file: String
  var methods: Int
  var properties: Int
}

final class Collector: SyntaxVisitor {
  private let file: String
  private let converter: SourceLocationConverter
  private var typeStack: [TypeContext] = []

  var imports: [String] = []
  var nodes: [String: GraphNode] = [:]
  var edges: [GraphEdge] = []
  var typeNames: Set<String> = []
  var typeSources: [String: String] = [:]
  var functionSources: [(id: String, parentType: String, source: String)] = []
  var properties: [(id: String, parentType: String, name: String)] = []
  var conformances: [(from: String, name: String)] = []

  init(file: String, source: String, sourceFile: SourceFileSyntax) {
    self.file = file
    self.converter = SourceLocationConverter(fileName: file, tree: sourceFile)
    super.init(viewMode: .sourceAccurate)
  }

  override func visit(_ node: ImportDeclSyntax) -> SyntaxVisitorContinueKind {
    imports.append(node.path.trimmedDescription)
    return .skipChildren
  }

  override func visit(_ node: StructDeclSyntax) -> SyntaxVisitorContinueKind {
    enterType(kind: "struct", name: node.name.text, inheritance: node.inheritanceClause?.trimmedDescription, syntax: Syntax(node))
    return .visitChildren
  }

  override func visitPost(_ node: StructDeclSyntax) {
    leaveType()
  }

  override func visit(_ node: ClassDeclSyntax) -> SyntaxVisitorContinueKind {
    enterType(kind: "class", name: node.name.text, inheritance: node.inheritanceClause?.trimmedDescription, syntax: Syntax(node))
    return .visitChildren
  }

  override func visitPost(_ node: ClassDeclSyntax) {
    leaveType()
  }

  override func visit(_ node: EnumDeclSyntax) -> SyntaxVisitorContinueKind {
    enterType(kind: "enum", name: node.name.text, inheritance: node.inheritanceClause?.trimmedDescription, syntax: Syntax(node))
    return .visitChildren
  }

  override func visitPost(_ node: EnumDeclSyntax) {
    leaveType()
  }

  override func visit(_ node: ProtocolDeclSyntax) -> SyntaxVisitorContinueKind {
    enterType(kind: "protocol", name: node.name.text, inheritance: node.inheritanceClause?.trimmedDescription, syntax: Syntax(node))
    return .visitChildren
  }

  override func visitPost(_ node: ProtocolDeclSyntax) {
    leaveType()
  }

  override func visit(_ node: FunctionDeclSyntax) -> SyntaxVisitorContinueKind {
    guard var currentType = typeStack.popLast() else {
      return .skipChildren
    }

    let name = node.name.text
    let functionSource = stripSwiftComments(node.trimmedDescription)
    let line = lineNumber(for: Syntax(node))
    let id = memberNodeId(kind: "function", file: currentType.file, typeName: currentType.name, name: name, line: line)
    nodes[id] = GraphNode(
      id: id,
      kind: "function",
      declarationKind: nil,
      name: name,
      file: file,
      line: line,
      metrics: metricsForFunctionSource(functionSource)
    )
    edges.append(GraphEdge(from: currentType.id, to: id, kind: "defines"))
    currentType.methods += 1
    functionSources.append((id: id, parentType: currentType.name, source: functionSource))
    typeStack.append(currentType)
    return .skipChildren
  }

  override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
    guard var currentType = typeStack.popLast() else {
      return .skipChildren
    }

    for binding in node.bindings {
      guard let identifier = binding.pattern.as(IdentifierPatternSyntax.self) else {
        continue
      }
      let name = identifier.identifier.text
      let line = lineNumber(for: Syntax(node))
      let id = memberNodeId(kind: "property", file: currentType.file, typeName: currentType.name, name: name, line: line)
      nodes[id] = GraphNode(
        id: id,
        kind: "property",
        declarationKind: nil,
        name: name,
        file: file,
        line: line,
        metrics: [:]
      )
      edges.append(GraphEdge(from: currentType.id, to: id, kind: "defines"))
      properties.append((id: id, parentType: currentType.name, name: name))
      currentType.properties += 1

      if node.attributes.trimmedDescription.contains("@State")
        || node.attributes.trimmedDescription.contains("@Environment")
        || node.attributes.trimmedDescription.contains("@Observable")
        || node.attributes.trimmedDescription.contains("@Binding") {
        edges.append(GraphEdge(from: currentType.id, to: id, kind: "owns_state"))
      }
    }

    typeStack.append(currentType)
    return .skipChildren
  }

  private func enterType(kind declarationKind: String, name: String, inheritance: String?, syntax: Syntax) {
    let inheritanceText = inheritance ?? ""
    let conformances = inheritanceConformances(inheritanceText)
    let source = stripSwiftComments(syntax.trimmedDescription)
    let kind = classifyType(declarationKind: declarationKind, name: name, conformances: conformances, source: source)
    let id = typeNodeId(file: file, name: name)
    let node = GraphNode(
      id: id,
      kind: kind,
      declarationKind: declarationKind,
      name: name,
      file: file,
      line: lineNumber(for: syntax),
      metrics: ["lines": countSourceLines(source), "methods": 0, "properties": 0]
    )
    nodes[id] = node
    typeNames.insert(name)
    typeSources[id] = source
    typeStack.append(TypeContext(id: id, name: name, file: file, methods: 0, properties: 0))

    conformances
      .forEach { conformance in
        self.conformances.append((from: id, name: conformance))
      }
  }

  private func leaveType() {
    guard let context = typeStack.popLast(),
          var node = nodes[context.id] else {
      return
    }
    node = GraphNode(
      id: node.id,
      kind: node.kind,
      declarationKind: node.declarationKind,
      name: node.name,
      file: node.file,
      line: node.line,
      metrics: [
        "lines": node.metrics["lines"] ?? 1,
        "methods": context.methods,
        "properties": context.properties
      ]
    )
    nodes[context.id] = node
  }

  private func lineNumber(for syntax: Syntax) -> Int {
    let location = syntax.startLocation(converter: converter)
    return location.line
  }
}

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
  fputs("Usage: scan-swift-syntax <input-root> <output-json>\n", stderr)
  exit(2)
}

let inputRoot = URL(fileURLWithPath: arguments[1]).standardizedFileURL
let outputURL = URL(fileURLWithPath: arguments[2]).standardizedFileURL
let files = try listSwiftFiles(inputRoot)
var nodes: [String: GraphNode] = [:]
var edges: [GraphEdge] = []
var typeNames: Set<String> = []
var typeSources: [String: String] = [:]
var typeIdsByName: [String: [String]] = [:]
var functionSources: [(id: String, parentType: String, source: String)] = []
var properties: [(id: String, parentType: String, name: String)] = []
var conformances: [(from: String, name: String)] = []

nodes["repo:root"] = GraphNode(
  id: "repo:root",
  kind: "repository",
  declarationKind: nil,
  name: inputRoot.lastPathComponent,
  file: "",
  line: 1,
  metrics: [:]
)

for fileURL in files {
  let source = try String(contentsOf: fileURL, encoding: .utf8)
  let relativeFile = relativePath(from: inputRoot, to: fileURL)
  let fileId = "file:\(relativeFile)"
  let sourceFile = Parser.parse(source: source)
  let lineCount = source.split(whereSeparator: \.isNewline).count

  nodes[fileId] = GraphNode(
    id: fileId,
    kind: "file",
    declarationKind: nil,
    name: relativeFile,
    file: relativeFile,
    line: 1,
    metrics: ["lines": lineCount]
  )
  edges.append(GraphEdge(from: "repo:root", to: fileId, kind: "contains"))

  let collector = Collector(file: relativeFile, source: source, sourceFile: sourceFile)
  collector.walk(sourceFile)

  for node in collector.nodes.values {
    nodes[node.id] = node
    if node.id.starts(with: "type:") {
      edges.append(GraphEdge(from: fileId, to: node.id, kind: "defines"))
      typeIdsByName[node.name, default: []].append(node.id)
    }
  }

  for importedModule in collector.imports {
    let importId = "module:\(importedModule)"
    nodes[importId] = GraphNode(
      id: importId,
      kind: "module",
      declarationKind: nil,
      name: importedModule,
      file: "",
      line: 1,
      metrics: [:]
    )
    edges.append(GraphEdge(from: fileId, to: importId, kind: "imports"))
  }

  edges.append(contentsOf: collector.edges)
  typeNames.formUnion(collector.typeNames)
  collector.typeSources.forEach { typeSources[$0.key] = $0.value }
  functionSources.append(contentsOf: collector.functionSources)
  properties.append(contentsOf: collector.properties)
  conformances.append(contentsOf: collector.conformances)
}

for (typeId, source) in typeSources {
  let typeName = nodes[typeId]?.name ?? String(typeId.split(separator: ":").last ?? "")
  for referencedType in typeNames where referencedType != typeName {
    if referencesType(source: source, typeName: referencedType) {
      for targetId in resolveTypeIds(typeIdsByName, name: referencedType, sourceId: typeId) {
        edges.append(GraphEdge(from: typeId, to: targetId, kind: "uses"))
      }
    }
  }
}

for functionSource in functionSources {
  for referencedType in typeNames where referencedType != functionSource.parentType {
    if referencesType(source: functionSource.source, typeName: referencedType) {
      for targetId in resolveTypeIds(typeIdsByName, name: referencedType, sourceId: functionSource.id) {
        edges.append(GraphEdge(from: functionSource.id, to: targetId, kind: "uses"))
      }
    }
  }

  for property in properties where property.parentType == functionSource.parentType {
    if referencesMember(source: functionSource.source, memberName: property.name) {
      edges.append(GraphEdge(from: functionSource.id, to: property.id, kind: "uses_member"))
    }
  }
}

for conformance in conformances {
  for targetId in resolveTypeIds(
    typeIdsByName,
    name: conformance.name,
    sourceId: conformance.from,
    fallbackId: externalTypeId(conformance.name)
  ) {
    edges.append(GraphEdge(from: conformance.from, to: targetId, kind: "conforms_to"))
  }
}

for edge in edges where edge.kind == "conforms_to" && nodes[edge.to] == nil {
  let protocolName = edge.to.hasPrefix("type:external:")
    ? String(edge.to.dropFirst("type:external:".count))
    : String(edge.to.split(separator: ":").last ?? "")
  nodes[edge.to] = GraphNode(
    id: edge.to,
    kind: "protocol",
    declarationKind: "protocol",
    name: protocolName,
    file: "",
    line: 1,
    metrics: [:]
  )
}

let graph = Graph(
  schemaVersion: 1,
  project: Project(
    name: inputRoot.lastPathComponent,
    scannedAt: ISO8601DateFormatter().string(from: Date()),
    sourceRoot: arguments[1]
  ),
  nodes: Array(nodes.values).sorted { $0.id < $1.id },
  edges: uniqueEdges(edges)
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(graph)
try data.write(to: outputURL)

func listSwiftFiles(_ root: URL) throws -> [URL] {
  guard let enumerator = FileManager.default.enumerator(
    at: root,
    includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey],
    options: [.skipsHiddenFiles]
  ) else {
    return []
  }

  var files: [URL] = []
  for item in enumerator {
    guard let url = item as? URL else { continue }
    let resourceValues = try url.resourceValues(forKeys: [.isRegularFileKey, .isDirectoryKey])
    if resourceValues.isDirectory == true && shouldSkipDirectory(url.lastPathComponent) {
      enumerator.skipDescendants()
      continue
    }
    if resourceValues.isRegularFile == true && url.pathExtension == "swift" {
      files.append(url)
    }
  }

  return files.sorted { $0.path < $1.path }
}

func shouldSkipDirectory(_ name: String) -> Bool {
  excludedDirectoryNames.contains(name) || name.hasSuffix(".xcodeproj") || name.hasSuffix(".xcworkspace")
}

func relativePath(from root: URL, to file: URL) -> String {
  let rootPath = root.path(percentEncoded: false).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  let filePath = file.path(percentEncoded: false)
  let prefix = "/" + rootPath + "/"
  return filePath.hasPrefix(prefix) ? String(filePath.dropFirst(prefix.count)) : file.lastPathComponent
}

func classifyType(declarationKind: String, name: String, conformances: [String], source: String) -> String {
  if conformances.contains("View") {
    return "swiftui_view"
  }
  if declarationKind == "class" {
    return "class"
  }
  if name.hasSuffix("Service") || name.hasSuffix("Store") {
    return "service"
  }
  if source.contains("\(name)(") && (source.contains("Identifiable") || source.contains(": String")) {
    return "model"
  }
  return declarationKind
}

func inheritanceConformances(_ inheritance: String) -> [String] {
  inheritance
    .replacingOccurrences(of: ":", with: "")
    .split(separator: ",")
    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
}

func referencesType(source: String, typeName: String) -> Bool {
  let escapedTypeName = NSRegularExpression.escapedPattern(for: typeName)
  let patterns = [
    "\\b\(escapedTypeName)\\s*\\(",
    "\\b\(escapedTypeName)\\s*\\.",
    "\\b\(escapedTypeName)\\s*<",
    "[:<,\\[]\\s*(?:some\\s+|any\\s+)?\(escapedTypeName)\\b",
    "\\b\(escapedTypeName)\\b"
  ]

  return patterns.contains { pattern in
    source.range(of: pattern, options: .regularExpression) != nil
  }
}

func referencesMember(source: String, memberName: String) -> Bool {
  source.range(of: "\\b\(NSRegularExpression.escapedPattern(for: memberName))\\b", options: .regularExpression) != nil
}

func typeNodeId(file: String, name: String) -> String {
  "type:\(file):\(name)"
}

func memberNodeId(kind: String, file: String, typeName: String, name: String, line: Int) -> String {
  "\(kind):\(file):\(typeName).\(name):\(line)"
}

func externalTypeId(_ name: String) -> String {
  "type:external:\(name)"
}

func resolveTypeIds(_ idsByName: [String: [String]], name: String, sourceId: String, fallbackId: String? = nil) -> [String] {
  let resolved = (idsByName[name] ?? []).filter { $0 != sourceId }
  if !resolved.isEmpty {
    return resolved
  }
  return fallbackId.map { [$0] } ?? []
}

func countSourceLines(_ source: String) -> Int {
  let lines = source
    .split(whereSeparator: \.isNewline)
    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty && !$0.hasPrefix("//") }
  return max(1, lines.count)
}

func metricsForFunctionSource(_ source: String) -> [String: Int] {
  [
    "lines": countSourceLines(source),
    "branches": matchCount(
      in: source,
      pattern: "\\b(if|else\\s+if|switch|case|for|while|guard|catch|async\\s+let|Task)\\b|\\?\\s*[^:]+:"
    ),
    "calls": matchCount(in: source, pattern: "\\b[A-Za-z_][A-Za-z0-9_]*\\s*\\(")
  ]
}

func matchCount(in source: String, pattern: String) -> Int {
  (try? NSRegularExpression(pattern: pattern))
    .map { expression in
      expression.numberOfMatches(
        in: source,
        range: NSRange(source.startIndex..<source.endIndex, in: source)
      )
    } ?? 0
}

func stripSwiftComments(_ source: String) -> String {
  var output = ""
  var index = source.startIndex
  var blockDepth = 0
  var inLineComment = false
  var inString = false
  var stringDelimiter = ""

  func hasPrefix(_ value: String, at index: String.Index) -> Bool {
    source[index...].hasPrefix(value)
  }

  while index < source.endIndex {
    let character = source[index]
    let nextIndex = source.index(after: index)
    let nextCharacter = nextIndex < source.endIndex ? source[nextIndex] : nil

    if inLineComment {
      if character == "\n" {
        inLineComment = false
        output.append("\n")
      } else {
        output.append(" ")
      }
      index = nextIndex
      continue
    }

    if blockDepth > 0 {
      if character == "/" && nextCharacter == "*" {
        blockDepth += 1
        output.append("  ")
        index = source.index(index, offsetBy: 2)
        continue
      }
      if character == "*" && nextCharacter == "/" {
        blockDepth -= 1
        output.append("  ")
        index = source.index(index, offsetBy: 2)
        continue
      }
      output.append(character == "\n" ? "\n" : " ")
      index = nextIndex
      continue
    }

    if inString {
      output.append(character)
      if character == "\\" && stringDelimiter == "\"" && nextCharacter != nil {
        output.append(nextCharacter!)
        index = source.index(index, offsetBy: 2)
        continue
      }
      if hasPrefix(stringDelimiter, at: index) {
        output.append(String(stringDelimiter.dropFirst()))
        index = source.index(index, offsetBy: stringDelimiter.count)
        inString = false
        stringDelimiter = ""
        continue
      }
      index = nextIndex
      continue
    }

    if hasPrefix("\"\"\"", at: index) {
      inString = true
      stringDelimiter = "\"\"\""
      output.append("\"\"\"")
      index = source.index(index, offsetBy: 3)
      continue
    }

    if character == "\"" {
      inString = true
      stringDelimiter = "\""
      output.append(character)
      index = nextIndex
      continue
    }

    if character == "/" && nextCharacter == "/" {
      inLineComment = true
      output.append("  ")
      index = source.index(index, offsetBy: 2)
      continue
    }

    if character == "/" && nextCharacter == "*" {
      blockDepth = 1
      output.append("  ")
      index = source.index(index, offsetBy: 2)
      continue
    }

    output.append(character)
    index = nextIndex
  }

  return output
}

func uniqueEdges(_ edges: [GraphEdge]) -> [GraphEdge] {
  var seen = Set<GraphEdge>()
  return edges.filter { edge in
    if seen.contains(edge) { return false }
    seen.insert(edge)
    return true
  }
}
