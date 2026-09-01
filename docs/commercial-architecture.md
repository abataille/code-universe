# Commercial Architecture

Status: activation foundation implemented; paid capabilities and checkout not yet
released.

## Boundary

The public repository contains the source-available Code Universe application,
its BSL licence, and the generic entitlement verifier. It must not contain:

- the private Ed25519 signing key;
- customer licence documents;
- payment-provider credentials or webhook secrets;
- proprietary Pro or Team implementation modules.

Commercial modules should be built from a separate private repository/package and
joined during the official release build. Public source must not import a private
package in its default development or test path.

## Offline activation

`lib/licensing/entitlements.js` verifies an Ed25519-signed JSON document. It checks
the product, edition, customer, licence identifier, validity dates, and feature
claims before persisting the document with owner-only file permissions.

The local API exposes:

- `GET /api/license` for the current status;
- `POST /api/license/activate` for a signed JSON licence document.

Official builds load `config/license-public-key.pem` by default. Development and
automation may instead provide `CODE_UNIVERSE_LICENSE_PUBLIC_KEY` or
`CODE_UNIVERSE_LICENSE_PUBLIC_KEY_PATH`; the local document location can be
overridden with `CODE_UNIVERSE_LICENSE_PATH`. The public key is distributed with
the app; the matching private key must remain outside the repository and release
bundle.

Create the production key pair only after choosing a secure external private-key
location and backup policy:

```sh
npm run license:keygen -- \
  --private-key "/secure/external/location/code-universe-private-key.pem" \
  --public-key "config/license-public-key.pem"
```

The tool refuses to put the private key inside the repository and refuses to
overwrite either key. The unencrypted PKCS#8 private key is created with owner-only
file permissions; its directory and backups must also be access-controlled and
encrypted.

Issue a customer document outside the repository:

```sh
npm run license:issue -- \
  --private-key "/secure/external/location/code-universe-private-key.pem" \
  --output "/secure/customer-licences/acme-team.license.json" \
  --customer "Acme GmbH" \
  --edition team \
  --expires "2027-09-01T00:00:00Z" \
  --features "impact-reports,team-policy"
```

Customer licence files are owner-readable by default. The issuer refuses to write
them inside the repository or overwrite an existing document.

No existing public capability is gated yet. Feature gates should be introduced
only when a real paid capability exists, and each gate must be enforced in the
local server or commercial module rather than only hidden in the browser UI.

## Release control

The existing `scripts/release-mac-app.sh` pipeline builds the official app, checks
the Developer ID signature and hardened runtime, notarizes and staples the app and
DMG, validates both artifacts, and emits SHA-256 checksums. Commercial distribution
must use those verified artifacts rather than unsigned builds from arbitrary forks.
