# Contributing to Code Universe

Thank you for helping improve Code Universe. Useful bug reports, reproducible
fixtures, workflow feedback, and focused design discussion are welcome.

## Before opening an issue

- Search existing issues first.
- Remove source code, credentials, customer information, and private repository
  paths from screenshots, logs, and sample data.
- Use the security-reporting process in `SECURITY.md` for vulnerabilities.
- Use the commercial-licensing contact on the VCLab website for licensing and
  account questions.

## Development setup

Code Universe currently targets macOS. Install a current Node.js LTS release,
npm, Swift 6, and Xcode command-line tools.

```sh
npm ci
npm test
swift build --package-path scanners/swiftsyntax-scanner
swift build --package-path mac/CodeUniverseMac
```

Useful focused checks include:

```sh
npm run test:scan
npm run test:languages
npm run test:review
npm run test:mcp
npm run test:license
```

## Code contributions

Code Universe is source-available under BSL 1.1 and is also intended for separate
commercial licensing. Dr. Raymund Vorwerk must retain the rights required to
maintain both licensing paths.

Until a contributor agreement has been legally reviewed and published, unsolicited
code pull requests cannot be accepted. Please open an issue before writing code.
A maintainer may invite a narrowly scoped pull request and will state the applicable
contribution terms before work begins.

This temporary restriction does not apply to bug reports, feature proposals, or
other feedback that does not include contributed source code.

## Quality expectations

An invited change should:

- address one clearly described problem;
- preserve local-only processing and project-boundary protections;
- include focused tests for behavioral changes;
- keep public and commercial modules separated;
- avoid committing generated apps, credentials, customer licences, or private keys;
- update user-facing documentation when behavior changes.

By participating, you agree to follow `CODE_OF_CONDUCT.md`.
