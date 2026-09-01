# Known Limitations

Code Universe 0.2.0 is a public preview. Use it to explore and review code, not as
the sole basis for a production or security decision.

## Platform and installation

- The official 0.2.0 DMG is built for Apple silicon Macs.
- There is no automatic updater. Install later previews manually from GitHub
  Releases.
- Running from source requires a current Node.js/npm environment. SwiftSyntax and
  Xcode-index analysis additionally require the relevant Apple developer tools.

## Analysis coverage

- Analysis depth varies by language. Swift has native scanner paths, TypeScript
  can use its semantic checker, and other adapters combine syntax and heuristic
  evidence.
- Optional Tree-sitter grammars cover only the languages listed in the README.
- Dynamic dispatch, reflection, generated code, runtime dependency injection, and
  build-system behavior cannot always be resolved statically.
- Large or generated repositories can produce noisy graphs. Exclude generated and
  vendored content where possible and use performance mode for large maps.
- Change-impact paths are evidence for review, not a proof that every affected
  file or test has been found.

## AI-agent review

- Code Universe project scanning runs locally. Starting a Codex behavior review
  invokes the locally installed Codex tooling under that tool's configured account,
  permissions, and data-handling terms.
- Agent traces depend on the events available from the selected Codex run. Some
  shell or tool activity may not map to a specific source object.
- Always inspect the resulting diff and verification output before applying or
  shipping an AI-assisted change.

## Licensing preview

- Pro and Team status can be verified and displayed, but no existing product
  capability differs between licensed and unlicensed use in 0.2.0.
- There is no automated checkout or licence delivery during public-preview
  validation.
- The exact permitted-use boundary is defined by `LICENSE`, not by the status
  label shown in the application.

Report reproducible problems through the repository issue forms after removing
private source, credentials, customer data, and identifying paths.
