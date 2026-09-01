# Code Universe Product Strategy

Status: accepted
Decision date: 2026-09-01

## Positioning

Code Universe is a local architecture and AI-agent review workspace for understanding unfamiliar codebases and verifying risky changes.

The navigable code city is the interface. The customer outcome is faster understanding, visible change impact, and review evidence.

## Initial customer

The initial customer is an agency, consultant, or technical lead who repeatedly inherits unfamiliar repositories or supervises AI-assisted changes.

This customer experiences the problem frequently, can validate the product on real work, and has a direct economic reason to pay for faster investigation and safer review.

## Primary paid workflow

1. Scan a local repository.
2. Understand its architecture and important entry points.
3. Investigate a proposed behavior or change.
4. See the agent's evidence trail and likely change impact.
5. Review the diff and verification results.
6. Approve, reject, or continue the work with confidence.

Product work should optimize this workflow before expanding visualization themes, language count, or general IDE functionality.

## Licensing direction

Code Universe uses a source-available, dual-licensing model.

- The public source is under Business Source License 1.1 (`BUSL-1.1`).
- Free use consists of BSL non-production use and the limited individual production use stated in `LICENSE`.
- Company use, client work, hosting, managed services, and commercial embedding require a commercial licence from Dr. Raymund Vorwerk; forks and redistributed copies remain subject to BSL.
- Each BSL version converts to Apache License 2.0 on its applicable Change Date.
- Official Pro and Team binaries are signed and notarized; commercial entitlements are verified offline.
- Proprietary commercial modules and all private signing/payment material remain outside the public repository.
- The legal licensor is **Dr. Raymund Vorwerk**; VCLab is the publisher and brand, not a separate legal entity.
- The Additional Use Grant and commercial agreement require legal review before publication.

## Naming

- Product: **Code Universe**
- Publisher: **VCLab**
- Legal licensor: **Dr. Raymund Vorwerk**
- Public signature: **Code Universe by VCLab**
- Current website: `vclab.com`

A product-specific domain may be considered later. The immediate priority is consistent use of the product and publisher names across the website, repository, releases, application, and documentation.

## Product decision test

Every major change must strengthen at least one outcome:

1. Understand an unfamiliar repository faster.
2. Predict what a proposed change can affect.
3. Verify what an AI coding agent inspected, changed, and tested.

If a change does not improve one of these outcomes or validate willingness to pay, defer it.

## Near-term boundaries

Do not prioritize additional visual themes, ornamental 3D effects, mobile companions, social features, cloud repository hosting, or a replacement IDE before the primary workflow is validated.

The accepted implementation sequence and validation gates are maintained in the [full roadmap](roadmap.md).
