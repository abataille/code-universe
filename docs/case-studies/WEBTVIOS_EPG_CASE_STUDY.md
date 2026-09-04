# WebTViOS EPG Performance — Founder-Led Case Study Record

**Status:** Published diagnostic case study; runtime hypothesis clearly labeled as unmeasured
**Publication verified:** 4 September 2026 — [GitHub README](https://github.com/abataille/code-universe#case-study-understanding-an-ai-modified-swift-app) and [VCLab replay section](https://www.vclab.com/#case-study)
**Study type:** Founder-led, single-project case study
**Study date:** 2 September 2026
**Application:** WebTViOS, a shipping App Store Swift application
**Repository:** Private local WebTViOS repository (path omitted)
**Branch:** `WithCoreData`
**Recorded commit:** `e2676554e9aef661af2b9deb8e53f7ea6cf88858`
**Code Universe version:** 0.2.0

## Why this is a relevant Code Universe case

WebTViOS is owned by the investigator, but its current implementation is only partially familiar. The older application has been changed several times by AI coding agents without subsequent manual source review. The relevant problem is therefore not simply “find slow code.” It is:

> Can the owner regain an accurate mental model of an AI-modified production application and reach a source-supported, reviewable diagnosis without asking another AI agent to change the code?

That situation matches Code Universe's intended workflow: understand an evolved or unfamiliar codebase, inspect what a change can affect, and retain evidence for reviewing AI-assisted work.

## Study question

> In an older shipping Swift application modified repeatedly by AI without manual intervention, can Code Universe reconstruct the EPG implementation, localize a plausible post-download performance regression, and expose the supporting evidence without modifying the application?

The reported timing is specific: the performance problem appears **after downloading new data**. That report is sufficient context for this diagnostic demonstration; it is not a measured duration. If runtime validation is pursued later, quantify the user-visible symptom with an observable statement such as:

- Opening the EPG sheet blocks interaction for **[x] seconds**.
- The interface stalls for **[x] seconds** after EPG data finishes downloading.
- The interface becomes unresponsive for **[x] seconds** after the download completes.
- New EPG content becomes usable **[x] seconds** after the network response arrives.
- Memory rises by **[x] MB** while parsing or displaying EPG data.

## Repository condition

The working tree was not clean during this investigation:

- `WebTViOS.xcodeproj/project.pbxproj` modified.
- `WebTViOS/ContentView.swift` modified.
- User breakpoint data modified.
- `build/` untracked.

The existing changes were preserved. No WebTViOS files were edited for this study. The Code Universe scan reflects the current working tree, including the existing `ContentView.swift` changes, while the recorded Git commit identifies its baseline.

For repeatable published measurements, use either a clean study worktree or commit the intended current state before profiling.

## Project profile

| Measure | Recorded value |
| --- | --- |
| Primary language | Swift |
| Project type | Xcode application |
| App version in project | 2.6.3 (build 168) |
| Swift files found in repository | 25, including playground content |
| Swift files scanned by Code Universe | 23 |
| Approximate Swift LOC | 5,283 |
| Tracked files | 113 |
| EPG implementation history | 2020–2026 |
| Most recent EPG-specific commit found | 11 May 2026, “Cache daily EPG feed data” |

### Feed snapshot used for the investigation

The public XMLTV feed was measured on 2 September 2026:

| Feed measure | Value |
| --- | ---: |
| Compressed download | 2,033,244 bytes |
| Decompressed XML | 12,933,961 bytes |
| Programme elements | 16,514 |
| Declared channel elements | 215 |
| Distinct channel IDs used by programmes | 189 |
| JSON produced by the app-equivalent model encoding | 7,300,785 bytes |

This is a mature shipping application, although it is medium-sized by source-line count. The EPG path is sufficiently deep for the case study because it crosses SwiftUI, Combine, networking, gzip decompression, XML parsing, caching, formatting, shared state, and multiple presentation surfaces.

## Baseline source investigation

### Entry points found

- `ContentView` owns `EPGFetcher` and starts loading after the channel collection changes.
- A one-minute main-run-loop ticker updates the current-channel EPG text.
- Toolbar actions display either the current-channel overlay, all-channel overlay, or EPG sheet.
- `EPGFetcher` publishes state used by `ContentView`.
- `EPGParser` checks cache, downloads, decompresses, parses, filters, and organizes the feed.
- `EPGCache` JSON-encodes and decodes the program collection in `UserDefaults`.
- `EPGView` and `EPGItem` retain a legacy presentation path through `EPG.epgData`.

### Files in the verified path

1. `WebTViOS/ContentView.swift`
2. `WebTViOS/EPG.swift`
3. `WebTViOS/EPGView.swift`
4. `WebTViOS/EPGOverlayView.swift`
5. `WebTViOS/HeaderToolbarView.swift`
6. Channel/Core Data files that provide channel EPG identifiers

## Code Universe run

### Scan result

The Fast Overview profile completed a clean, uncached local scan in approximately **0.10 seconds** on this machine.

| Code Universe measure | Result |
| --- | ---: |
| Swift files | 23 |
| Graph nodes | 823 |
| Graph relationships | 1,745 |
| Types/components | 90 |
| Functions | 171 |
| Properties/data nodes | 442 |
| Relationships containing EPG-relevant identities | 399 |

The scan identified the EPG views, overlay state, fetcher, parser, XML parser, cache, date formatter, compatibility layer, display functions, and their source locations.

### Useful moment

Searching the graph for EPG grouped the feature into one inspectable surface and exposed that the problem is not confined to `EPG.swift`. The visible path crosses:

> toolbar and view state → overlay/sheet rendering → `EPGFetcher` → `EPGParser` → cache or network/gzip/XML → channel filtering → timestamp formatting

This is the part of Code Universe that helped: it re-established the current feature boundary after several unreviewed AI changes and exposed the relevant source locations before another AI-generated optimization could be accepted in isolation.

The central value is not that Code Universe replaces text search or Instruments. It is that the owner can see which current implementation the agent inspected, how its conclusion relates to the architecture, which files a correction touches, and whether the promised verification actually occurred.

## Code Universe inspect-only review

The production Code Universe workflow completed successfully after the desktop MCP launch correction.

| Review measure | Result |
| --- | --- |
| Review ID | `ec5aa536-345f-41e7-8b53-9e9a723b9195` |
| Mode | Inspect only; no WebTViOS files modified |
| Model | `gpt-5.6-sol`, medium reasoning |
| Result | Completed successfully |
| Evidence events retained | 27 |
| Codex thread | `01a06250-1767-7f60-8620-956f2f30913b` |

The review traced the execution from channel loading through cache lookup, URLSession, gzip decompression, XML parsing, cache persistence, channel filtering, observable-state publication, and SwiftUI rendering. It identified the critical transition at `EPG.swift:216`: XML parsing runs on a background queue, but its completion is dispatched to the main queue. The completion then performs the expensive post-download chain synchronously.

### Most likely regression

The strongest source-supported explanation is a main-thread post-processing burst introduced by commit `c564610` (`Cache daily EPG feed data`, 11 May 2026):

1. XML parsing completes off the main thread.
2. Completion moves to the main queue.
3. The complete, unfiltered programme feed is JSON-encoded.
4. Approximately 7.3 MB is stored in `UserDefaults`.
5. The complete feed is scanned once for every configured EPG channel.
6. The filtered dictionary is published from a root-owned observable object.
7. SwiftUI reconsiders a hierarchy containing the channel/player grid.

Before `c564610`, the implementation filtered the feed first and cached the smaller channel-indexed result. The commit changed that order to cache the complete feed before filtering it. Git history therefore supplies concrete regression evidence that matches the reported timing. It does not establish whether the commit was AI-authored, so the publication must describe it as an earlier change in an AI-modified codebase rather than claiming proven AI authorship.

### Ranked bottlenecks from the review

1. Full-feed JSON encoding and `UserDefaults` storage on the main thread — highest confidence.
2. Repeated full-array filtering for every configured channel on the main thread — high confidence.
3. Root SwiftUI invalidation and player-grid reconciliation — medium/high confidence.
4. Full-feed decoding and repeated filtering on warm-cache loads — high confidence, but not specific to a fresh download.
5. Repeated whole-dataset conversion through the legacy `EPG.epgData` compatibility getter — conditional but potentially severe.
6. gzip and XML parsing — measurable CPU and memory costs, but unlikely to explain a UI freeze that begins after parsing completes because parsing is already backgrounded.

This result improves the investigation from a list of plausible expensive operations to one historically supported execution-chain hypothesis. It remains a hypothesis about the dominant wall-clock cost until measured on the affected device.

### Limitation found

The Fast Overview heuristic produced overly broad `uses_member` relationships for some local variables with repeated names, including variables from the two EPG update functions. The graph remains useful for locating the feature, but not every displayed relationship should be treated as a real call or data dependency. Source verification is required.

This limitation should be included in the publication. It is also a concrete Code Universe improvement candidate: owner-aware symbol resolution should distinguish local variables with identical names in adjacent functions.

## Source-verified performance hypotheses

These are hypotheses supported by code structure. They are not measured conclusions yet.

### 1. Post-parse cache encoding and filtering run after a main-queue handoff

`EPGXMLParser` parses on a global queue, then dispatches its completion to the main queue. That completion calls the parser success path, which performs `saveProgramsForToday`, `filterAndArrangeByChannel`, dictionary assignments, promise delivery, and observable-state publication.

This exactly matches the reported timing: the network transfer is over and XML parsing completes, then substantial work begins on the UI queue.

Likely cost:

- JSON-encoding the complete 16,514-program collection.
- Passing approximately 7.3 MB to `UserDefaults`.
- Filtering the full collection for configured channels.
- Copying/assigning large value collections.
- Publishing the resulting dictionary and triggering SwiftUI updates.

Evidence to collect: an Instruments interval beginning at the parser's main-queue completion and ending after `EPGFetcher.epgData` is published and the interface becomes responsive.

### 2. Warm-cache decoding and filtering can run synchronously from UI-triggered loading

`EPGFetcher.load()` subscribes to a `Future`. On the cache path, the future immediately reads and JSON-decodes the entire program array from `UserDefaults`, then filters and rearranges it before delivering the result. The load is triggered by SwiftUI when the channel collection changes.

Likely cost:

- Large JSON decode.
- Main-thread or caller-thread work before `receive(on:)` can move delivery.
- Full feed filtering immediately after decode.

Evidence to collect: Time Profiler trace and signpost duration for cache read/decode and filtering during warm launch.

### 3. Channel filtering is proportional to channels multiplied by all feed programs

`filterAndArrangeByChannel` loops over every configured channel and filters the complete program array for each channel. Its rough cost is **O(configured channels × feed programs)**, including repeated channel comparisons and date-string checks.

Evidence to collect: configured-channel count, total parsed-program count, retained-program count, and filter duration.

### 4. The compatibility property rebuilds all EPG models whenever it is read

`EPG.epgData` converts every `EPGProgram` into a legacy `Sendung` value and constructs a new dictionary on every access. `EPGItem.getEPGArray` reads this compatibility property from SwiftUI body work. With several channel columns, the same complete conversion can happen repeatedly during rendering.

Evidence to collect: allocation count and time spent in the compatibility getter while opening and scrolling the EPG sheet.

### 5. The EPG sheet eagerly builds data and views

`EPGView` uses a horizontal `HStack`, and each `EPGItem` uses a vertical `VStack`. Each item calculates its display array in `body`, formats timestamps, and renders its entire program list. Large channel/program collections can create substantial up-front SwiftUI work.

Evidence to collect: EPG sheet presentation latency, SwiftUI body evaluation samples, rendered row count, and allocations. Compare with lazy stacks only after obtaining the baseline.

### 6. Current/all-channel formatting repeatedly parses timestamp strings

The overlay update functions call `EPG.getNumber` for start and stop values and call `dateReadable` again for displayed values. Each call reparses an XML timestamp through a shared `DateFormatter`. The current-channel update repeats every minute.

Evidence to collect: formatter call count and aggregate formatter duration for one overlay presentation and one ticker update.

### 7. The current-channel overlay performs an unexpected all-channel update

`showCurrentChannelEPGOverlay()` calls `updateAllChannelsEPG()` before toggling the current-channel overlay. This appears unnecessary for the requested surface and may add channel-wide work to a current-channel interaction.

Evidence to collect: compare current-overlay presentation time with and without this call in a controlled branch.

### 8. Repeated channel changes may start overlapping loads

The EPG load is triggered by `onChange(of: channels)`. `EPGFetcher.load()` retains subscriptions but does not visibly cancel or deduplicate an existing load. If channel updates arrive more than once, overlapping cache or network work is possible.

Evidence to collect: count load invocations, concurrent subscriptions, network requests, and parser instances during launch and channel editing.

## Initial truth table

| Finding | Code Universe indicated | Source verification | Result |
| --- | --- | --- | --- |
| EPG crosses UI, fetcher, parser, cache, and formatter | Yes | Confirmed in four primary Swift files | Correct and useful |
| `ContentView` owns EPG state and display updates | Yes | Confirmed | Correct and useful |
| Cache, parser, and formatter are central dependencies | Yes | Confirmed | Correct and useful |
| All heuristic member edges represent real dependencies | Implied by graph | Repeated local-variable names caused broad matches | Partial / misleading |
| Main-thread post-download chain | Review traced cache encoding, persistence, filtering, publication, and rendering after the parser's main-queue handoff | Confirmed in `EPG.swift`, `ContentView.swift`, and `ChannelGridView.swift` | Correct and decision-relevant |
| Regression-producing behavior change | Review identified commit `c564610` changing filtered-result caching to full-feed caching | Confirmed against Git history and current source | Strong historical evidence |
| Exact dominant runtime cost | Review ranked the likely costs | Requires device profiling | Not yet established |

## Host-side post-download benchmark

A standalone optimized Swift benchmark reproduced the application's XML model, XML parsing, JSON encoding, and filtering algorithms against the current public feed. It ran five times on the development Mac. These values characterize algorithmic work only; they are not iPhone/iPad performance claims.

| Operation | Median host result |
| --- | ---: |
| Parse 12.93 MB XML / 16,514 programmes | 215.09 ms |
| Encode all programmes to 7.30 MB JSON | 41.38 ms |
| Current repeated filtering, 25 sample channels | 5.38 ms |
| One-pass index, 25 sample channels | 2.54 ms |
| Current repeated filtering, all 189 programme channel IDs | 42.33 ms |
| One-pass index, all 189 programme channel IDs | 14.13 ms |

The benchmark establishes three useful facts:

1. XML parsing is the largest measured CPU stage, but the current implementation already performs it off the main queue.
2. JSON encoding and channel filtering add meaningful work after parsing; the current control flow places them after the main-queue handoff.
3. A one-pass index produces equivalent results and scales better than filtering the complete programme collection once per channel.

The benchmark does **not** include `UserDefaults` persistence cost, SwiftUI publication/rendering, value-copy cost on the device, or contention with video playback. It supports the diagnosis but does not prove which stage dominates on a device.

## Optional runtime-validation runbook

Use a physical device representative of the reported problem. Record the device, OS, network, channel count, and feed size.

### Scenario A — Cold network load

1. Clear the EPG cache.
2. Launch the app from a terminated state.
3. Measure download, gzip decompression, XML parse, cache save, filtering, and first usable EPG presentation separately.
4. Record main-thread stalls, peak memory, parsed programs, and retained programs.

### Scenario B — Warm cached load

1. Confirm today's cache exists.
2. Terminate and relaunch.
3. Measure cache data read, JSON decode, filtering, publication, and first interaction.
4. Record main-thread stalls and peak memory.

### Scenario C — Current-channel overlay

1. Start with loaded EPG data.
2. Open the current-channel overlay ten times.
3. Record median and slowest presentation latency.
4. Count timestamp parses and verify whether all-channel work runs.

### Scenario D — All-channel overlay

1. Open the all-channel overlay ten times.
2. Record median and slowest latency.
3. Record channels examined, programs examined, and formatter calls.

### Scenario E — EPG sheet

1. Open the EPG sheet from a settled app.
2. Record time to first visible content and time until scrolling is responsive.
3. Record created view count, allocations, and peak memory.
4. Scroll across all channels and note hitching.

## Optional metrics table

| Scenario | Baseline median | Baseline worst | Optimized median | Optimized worst | Peak memory change |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold EPG load | TBD | TBD | TBD | TBD | TBD |
| Warm EPG load | TBD | TBD | TBD | TBD | TBD |
| Current overlay | TBD | TBD | TBD | TBD | TBD |
| All-channel overlay | TBD | TBD | TBD | TBD | TBD |
| EPG sheet first content | TBD | TBD | TBD | TBD | TBD |

## Possible optimization order if the application is repaired later

Do not implement all changes at once. Preserve a measurable before/after result.

1. Keep cache encoding/storage, filtering, and indexing off the main actor; publish only the final channel-indexed result on the main actor.
2. Build a single channel index in one pass instead of filtering the entire feed per channel.
3. Measure whether a file cache is more appropriate than storing approximately 7.3 MB in `UserDefaults`.
4. Remove unnecessary all-channel work from current-channel presentation if profiling confirms it runs.
5. Eliminate repeated whole-dataset conversion through the compatibility getter.
6. Store parsed `Date` values or numeric intervals once instead of repeatedly parsing timestamp strings.
7. Replace eager EPG stacks and body-time transformations with precomputed row models and lazy containers.
8. Deduplicate or cancel overlapping loads.

## Current assessment

**Signal: Strong for localization and review traceability.**

Code Universe found the complete feature surface quickly and reconstructed an implementation that had evolved through several unreviewed AI changes. Its inspect-only review did more than identify generally expensive code: it traced the precise main-queue boundary, ranked the synchronous work that follows it, and found a historical behavior change that matches the reported timing. This prevented the investigation from focusing only on background XML parsing and produced a focused first experiment.

The result also exposed two limitations. The fast graph contains false-positive member relationships, so important edges still require source confirmation. The completed review consumed substantial model context while examining a medium-sized Swift project, which is a product-efficiency issue worth tracking even though the run succeeded.

This case study is publishable as a demonstration of Code Universe's diagnostic usefulness. It must not claim that the dominant runtime bottleneck was experimentally proven or that application performance improved: no WebTViOS source was changed and no device before/after test was performed. That boundary is part of the evidence, not missing work required for this case study.

## Replay asset

A 30-second silent case-study replay is prepared in two H.264 exports:

- [Website master](media/webtvios-epg/code-universe-webtvios-epg-case-study.mp4), 1152×648, approximately 2.1 MB.
- [GitHub preview](media/webtvios-epg/code-universe-webtvios-epg-case-study-github.mp4), 960×540, approximately 1.0 MB.
- [Poster frame](media/webtvios-epg/code-universe-webtvios-epg-case-study-poster.jpg), 1152×648.
- [Export manifest](media/webtvios-epg/CODE_UNIVERSE_WEBTVIOS_REPLAY_MANIFEST.md), including checksums and provenance.
- [Architecture and review trace screenshot](media/code-universe-webtvios-overview.png).
- [Detailed review result screenshot](media/code-universe-webtvios-review-result.png).

The original 23.5-second Code Universe replay is preserved without cropping or overlays. A short title card establishes the founder-led case-study context, and an end card states the source-supported diagnosis and that no source changes were made. Device measurement is optional follow-up work, not a requirement for this demonstration.

## Publication title

> Regaining control of an AI-modified Swift app: tracing an EPG regression with Code Universe

## Publication summary

> In a founder-led test, Code Universe mapped a shipping Swift television app that had been modified repeatedly by AI without manual source review. Its inspect-only review traced a reported post-download UI stall to a plausible main-thread chain that JSON-encodes and stores the complete 16,514-program feed, repeatedly filters it by channel, and then republishes root-owned SwiftUI state. Git history connected the behavior to a change that replaced filtered-result caching with full-feed caching. No application files were modified; the result is a source-supported diagnosis, not a measured performance claim.

## Publication checklist

- [x] Record the study revision and disclose the dirty working-tree condition.
- [x] Run the EPG investigation through Code Universe's inspect-only review and retain its evidence trail.
- [x] Capture publication-safe Code Universe screenshots.
- [x] Prepare a short, publication-safe Code Universe replay movie.
- [x] Include misses and false-positive graph relationships.
- [x] Disclose that this is a founder-owned project and not an independent benchmark.
- [x] State that no source change or measured performance improvement is claimed.
- [x] Prepare a prominent GitHub README preview and link to the complete study.
- [x] Prepare the VCLab case-study section with the replay and a link to the complete study.
- [x] Verify the updated README and VCLab section on their live public URLs after deployment (4 September 2026; desktop and mobile layouts, 30-second video metadata, and no horizontal overflow).
