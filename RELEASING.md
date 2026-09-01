# Releasing Code Universe

This checklist keeps the Git tag, notarized artifacts, checksums, and GitHub
release aligned.

## Prepare

1. Confirm `main` is clean and synchronized with `origin/main`.
2. Set the same version in `package.json` and `package-lock.json`.
3. Move the changelog entry from Unreleased to the release version and date.
4. Update installation notes, known limitations, screenshots, and announcement
   copy when the product behavior changed.
5. Confirm no private signing key, customer licence, payment credential, or
   notarization credential is tracked.

## Verify

```sh
npm ci
npm test
npm audit --omit=dev --audit-level=high
swift build -c release --package-path scanners/swiftsyntax-scanner
swift build -c release --package-path mac/CodeUniverseMac
```

## Build the public artifacts

The release command uses the configured Developer ID identity and the
`code-universe-notary` Keychain profile. Credentials remain outside the repository.

```sh
npm run mac:release
```

Before publication, verify the Developer ID signature, hardened runtime, Apple
notarization and stapling, Gatekeeper assessment, DMG integrity, and both SHA-256
files. The DMG is the primary download; the ZIP is secondary.

## Publish

1. Commit and push the prepared release state.
2. Create and push an annotated `vX.Y.Z` tag on that exact commit.
3. Create the GitHub release from the tag and upload the DMG, ZIP, and both
   checksum files.
4. Download or inspect the published assets and confirm their names, sizes, and
   checksums.
5. Verify the release is marked latest and the website points to GitHub Releases.
