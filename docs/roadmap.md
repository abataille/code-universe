# Code Universe — Product and Launch Roadmap

Status: Accepted
Decision date: 1 September 2026
Publisher: VCLab
Product: Code Universe

## Product direction

Code Universe is a local architecture and AI-agent review workspace for understanding unfamiliar codebases and verifying risky changes.

The navigable code city remains the product's distinctive interface, but it is not the commercial promise. The promise is faster understanding, visible change impact, and evidence for reviewing AI-assisted work.

## Phase 0 — Product foundation

### Primary customer

The initial customer is an agency, consultant, or technical lead who repeatedly inherits unfamiliar repositories or supervises AI-assisted changes.

This audience is the initial focus because it experiences the problem frequently, can evaluate the product using real client work, and has a direct economic reason to pay for saved investigation and review time.

### Primary paid workflow

1. Scan a local repository.
2. Understand its architecture and important entry points.
3. Investigate a proposed behavior or change.
4. See the agent's evidence trail and likely change impact.
5. Review the diff and verification results.
6. Approve, reject, or continue the work with confidence.

The product should optimize this workflow before adding more languages, visualization themes, or general-purpose IDE features.

### Licensing model

Use a source-available, dual-licensing model:

- The public source is licensed under Business Source License 1.1 (`BUSL-1.1`).
- Free use consists of BSL non-production use and the limited individual production use stated in `LICENSE`.
- Company use, client work, hosting, managed services, and commercial embedding require a commercial licence from Dr. Raymund Vorwerk; forks and redistributed copies remain subject to BSL.
- Each version converts to Apache License 2.0 on its applicable Change Date.
- Official Pro and Team releases use signed, notarized binaries and locally verified commercial entitlements.
- Proprietary commercial modules, customer licences, payment credentials, and the licence-signing private key remain outside the public repository.
- The legal licensor is **Dr. Raymund Vorwerk**; VCLab is the publisher and brand, not a separate legal entity.
- The Additional Use Grant and commercial agreement are publication gates requiring qualified legal review.

### Product and publisher naming

- Product name: **Code Universe**
- Publisher: **VCLab**
- Legal licensor: **Dr. Raymund Vorwerk**
- Public signature: **Code Universe by VCLab**
- `vclab.com` remains the publisher-owned home for now.
- A product-specific domain may be acquired later, but it is not required for the initial launch.

## Phase 1 — GitHub launch readiness

Objective: make the public repository trustworthy, installable, and aligned with the current product.

Progress update — 1 September 2026: repository policies, issue forms, pull-request guidance, Dependabot, product CI, Swift builds, licence checks, ad-hoc package validation, an in-app licence screen, and secure-path key/issuance tooling are implemented and committed locally. Publication remains pending review.

### Deliverables

- Rewrite the README around value, proof, download, quick start, privacy, and supported platforms.
- Publish an accurate `v0.2.0` release covering the current multi-language product.
- Provide signed and notarized downloads, checksums, requirements, known limitations, and upgrade notes.
- Add `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, and `ROADMAP.md`.
- Add issue forms and a pull-request template.
- Add continuous integration for JavaScript tests, Swift builds, scanners, MCP, review flow, visual regression, and packaging checks.
- Complete package metadata and automate dependency updates.

### Completion criteria

- A new user can install Code Universe in under five minutes.
- The latest release matches the current product.
- Licensing is unambiguous.
- CI passes from a clean clone.
- The README communicates value and download options before implementation detail.

## Phase 2 — Public-preview validation

Objective: turn public interest into real repository trials, observable feedback,
and evidence that the workflow deserves further investment.

### Page sequence

1. Hero: product, outcome, primary action, and the city as the dominant visual.
2. Proof: one concrete repository-understanding result.
3. Workflows: understand, assess impact, and review an agent.
4. Trust: local processing, security boundaries, requirements, and current release.
5. Participation: try the preview, report friction, or discuss a concrete pilot.

### Deliverables

- Use “Understand the code. Verify the change.” as the central promise.
- Make “Try the public preview” the primary action until a signed release is ready.
- Embed a 60–90 second demonstration.
- Demonstrate real permissively licensed Swift, TypeScript, and mixed-language repositories.
- Add getting-started, review, security, changelog, and FAQ pages as real user questions emerge.
- Prefer GitHub issues and direct interviews over a speculative beta or pricing funnel.
- Add a sitemap, icons, canonical URLs, social metadata, and SoftwareApplication structured data.
- Keep all website, documentation, screenshots, and releases aligned.

### Completion criteria

- Qualified visitors understand the audience and benefit within five seconds.
- Ten developers attempt a real repository task.
- Five users describe the useful moment and the point where they stopped.
- At least one real-repository case study is published.

## Phase 3 — Product changes

Objective: turn the visual map into a repeatable decision workflow.

### P0: First success

- Guided repository scan.
- Entry-point and hotspot summary.
- Recent projects and saved context.
- Progressive disclosure of advanced parser and layer controls.
- Improved labels, semantic zoom, collision handling, focus, and keyboard navigation.

### P1: Actionable architecture

- Change-impact workspace for files, symbols, diffs, and proposed tasks.
- Direct and transitive dependencies, likely tests, boundaries, and risky hubs.
- Working-tree, commit, and branch comparisons.
- Deterministic architecture findings such as cycles, fan-in/fan-out, oversized types, unused assets, broken references, and boundary violations.
- Exportable HTML or PDF review reports.

### P2: Agent-review platform

- Agent-neutral trace schema with first-class Codex support.
- Importers or integrations for other MCP-capable agents where demand is proven.
- Approval gates for high-risk symbols, required tests, protected areas, and architecture boundaries.
- Later: shared review history, comments, approvals, policies, and CI integration.

### P3: Packaging and reliability

- Automatic updates and universal Mac builds.
- Incremental scanning and explicit large-repository performance budgets.
- Privacy-respecting crash diagnostics.
- Exclusion rules, secret protection, backups, accessibility, and signed update feeds.

## Explicitly deferred

- Additional visual themes and ornamental 3D effects.
- Mobile companion apps.
- Social or community features.
- Languages added only to increase the supported-language count.
- Cloud repository hosting.
- A replacement IDE.
- Proprietary AI-model hosting.
- Automated checkout and licence delivery.
- Anti-tampering or code-obfuscation work.
- Pro/Team feature gates before willingness to pay is demonstrated.

## Validation gates

Do not expand the roadmap materially until the product reaches:

- 100 qualified GitHub stars or 100 genuine downloads.
- 20 observed user sessions.
- 40% completion of a real repository scan.
- 25% seven-day return rate.
- One paid pilot or three credible statements of willingness to pay before
  commercial infrastructure resumes.
- One workflow with demonstrable time savings.

## Recommended sequence

| Period | Focus |
| --- | --- |
| Week 1 | Phase 0 decisions, license, positioning, README foundation |
| Week 2 | CI, clean installation, accurate `v0.2.0` release |
| Week 3 | Public-preview website, demo, GitHub feedback path, and technical SEO |
| Week 4 | Real-repository proof, observed trials, and direct outreach |
| Weeks 5–6 | Guided first scan and simplified default workspace |
| Weeks 7–9 | Change-impact workspace and comparisons |
| Weeks 10–12 | Agent-neutral trace prototype and review reports |

## Decision rule

Every major change must strengthen at least one of these outcomes:

1. Understand an unfamiliar repository faster.
2. Predict what a proposed change can affect.
3. Verify what an AI coding agent inspected, changed, and tested.

If a change does not improve one of these outcomes or provide evidence that customers will pay, defer it.
