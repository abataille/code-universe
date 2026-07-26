export function detectComponentFramework(file, sourceFile) {
  const imports = sourceFile.statements
    .filter((statement) => statement.moduleSpecifier?.text)
    .map((statement) => statement.moduleSpecifier.text);
  if (imports.some((specifier) => specifier === "preact" || specifier.startsWith("preact/"))) return "preact";
  if (imports.some((specifier) => specifier === "solid-js" || specifier.startsWith("solid-js/"))) return "solid";
  if (imports.some((specifier) => specifier === "next" || specifier.startsWith("next/"))
    || /(^|\/)(?:app|pages)\//.test(file)) return "nextjs";
  if (imports.some((specifier) => specifier === "react" || specifier.startsWith("react/"))
    || /\.[jt]sx$/i.test(file)) return "react";
  return "jsx";
}

export function frameworkAttributes(file, sourceFile, component) {
  if (!component) return {};
  return {
    framework: detectComponentFramework(file, sourceFile),
    component: true
  };
}
