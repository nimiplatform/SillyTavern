## Windows candidate 1.19.6 — 2026-10-13

Unreleased adaptation with SDK 0.21.0, Kit/native 0.19.3, App Tools 0.12.2 and Nimi Coding 0.6.5. The 439-test App suite passes. Windows packaging has an explicit target, portable CSS invocation and required author metadata. The supervised App against Nimi 0.2.2 generated a real two-sentence Chinese librarian reply through qwen3.8-flash; reload preserved the chat. Windows speech, images, retrieval and external tools remain NOT-VERIFIED. New public admission needs the publisher's safety declaration; candidate installation remains NOT-VERIFIED. Earlier macOS evidence keeps its stated release and scope.

## Catalog App support for source Runtime — 1.19.5

This release resolves public npm Kit/native **0.19.2** in the frozen lockfile,
with SDK **0.21.0** and App Tools **0.12.0**. Launch the installed Catalog App
through Nimi Home in either the supported production environment or the macOS
source-development environment. The App always loads its own packaged native
carrier. Source Runtime peer identity and installed-App/session admission remain
verified; no workspace carrier replacement or trust-check bypass is used.

Catalog AI acceptance passed on macOS arm64 using the actual [1.19.5 Release](https://github.com/nimiplatform/SillyTavern/releases/tag/v1.19.5) admitted by [Registry PR #74](https://github.com/nimiplatform/nimi-app-registry/pull/74), downloaded and launched through source Nimi Home. Generated a real character-chat reply with Deepseek v4 flash, synthesized narration with qwen3-tts-flash, played and exported the 15.28-second WAV, then relaunched through Home and reopened the saved chat with its audio attachments.

Local screenshots and exported results are in `.nimi/local/released-dependencies-20261012/`. Windows interactive acceptance and other unrun AI modalities remain **NOT-VERIFIED**. These results supersede the earlier Catalog limitation; historical results below retain their stated versions.

# SillyTavern on Nimi

This adaptation keeps SillyTavern's JavaScript/jQuery UI, Express data services,
character cards, Persona, PromptManager, worlds, chats and AGPL-3.0 license.
Upstream: https://github.com/SillyTavern/SillyTavern at
`06bde939fb1e9c4c8d8641d810f0a916b5bce127` (1.19.0).
The Nimi adaptation's current package version is 1.19.3.
Nimi supplies AI execution and configuration through the public Local App SDK
and the Desktop-supervised Electron Host. SillyTavern owns its characters,
conversation turns and business tool handlers.

Implementation and acceptance are in progress. In the Desktop-supervised macOS
arm64 development App, character JSON import/edit/export, Local multi-turn role
chat, Cloud world-book atDepth and Author's Note, actual App tool callbacks and
following model turns, public Microsoft Learn search/fetch tool rounds, group
list-order replies, Persona recall, edit/swipe/continue, first generation without a user turn, empty input with existing user history, stop followed by a
new request and chat switch, Data Bank retrieval, chat summary,
Cloud image generation, an owned-reference bag-color edit and a real image
description, message translation, finite Local emotion decisions, saved Cloud TTS
WAV playback/export, Local Z-Image generation, Local Qwen3 TTS playback, and finite Cloud ASR have run successfully. ASR made errors on
Chinese proper names; this run reported no language or word times. A successful
generated reference does not certify the product.

Daily testing uses `pnpm dev`, with the launcher's exact loopback CDP target.
Keep the existing registration with `pnpm dev -- --list-registrations` and
`pnpm dev -- --resume <the current selector>`; a new plain launch creates another
development audience. The actual renderer is SillyTavern at
`http://127.0.0.1:1476`. Source platform development uses `pnpm dev:runtime` and
`pnpm dev:desktop` in the Nimi repository. Package build/pack/local import belong
to the final delivery check. No system-service installation is needed for this
source development topology.

Setup: `pnpm install`, then `pnpm exec install-electron --no` (this repository
keeps its original ignore-scripts policy). Use `pnpm test:app` and `pnpm lint`;
the original tests package owns browser regressions, run with
`ST_BASE_URL=http://127.0.0.1:1476 pnpm --dir tests exec playwright test`.

Current dependencies use published npm SDK `^0.21.0`, Kit/native `^0.19.0`,
App Tools `^0.12.0` and Nimi Coding `0.6.5`, with Electron 44 and a frozen pnpm
lock. No Nimi local package override remains.

Current checks: 439 unit tests in 25 suites; the original browser suite passed
542 tests with 13 conditional skips, followed by 17 relevant browser checks.
App check, build and managed sync passed. Runtime localexecution/localservice/AI
checks passed for the projection repair; AI, nimillm, capabilitydriver and
remoteexecution checks passed for owned Cloud image input. Authority check,
compile, diff and impact passed. The full anchor check still reports the
pre-existing Laya `encoder/config.json` lexical path issue; no unrelated
canonical meaning was changed to suppress it. The userless text extension passed
587 SDK tests, 8 native text tests, and the Runtime AI, nimillm, localexecution
and textbehavior packages. App and same-package reference checks/builds passed;
the reference also completed a real Local text request.
The installed server serves its precompiled library without evaluating the
development Webpack cache configuration. This fixes static asset HTTP 500s from
Electron's unsupported `shake256` digest; the development compiler stays in the
build/development path.

The earlier Local TTS load failure and Local image configuration failure are
retained in saved results. Preparing their missing Runtime components through
Desktop restored both paths. Z-Image accepts pixel dimensions; a saved Cloud
aspect-ratio override is rejected explicitly and must be cleared in the App.
Exact raw
and assistant prefill, native named completion objects, raw reasoning/logprobs,
and App-side provider/model download or private inference remain unavailable.
A nonempty system/assistant context now supports first-turn generation through
the matching SDK, native carrier and Runtime without a filler user message.
Empty or opaque-only requests remain invalid. Prompt preparation also rejects
budget truncation that removes all existing user history. Empty input on a real
existing history works. One empty-input forest-character continuation invented a conflicting
world-book fact; subsequent Regenerate used the correct facts. The discrepancy
is retained as a content-quality issue. Prompt
budgets must retain the actual conversation needed by a tool round; there is
no placeholder user or automatic history rewrite. Local emotion decisions and the original Seraphina joy sprite have been
verified, with the full decision saved in the actual message. Integration
consumer cancellation is sent on stop, chat switch and timeout independently
of a provider's cancellation feature. Original call IDs and confirmed results
are retained; uncertain outcomes stay unconfirmed and are never resubmitted.
Desktop local import is available. The exact archive and installed
launch/stop/reopen results are recorded in `.nimi/local/acceptance-current.md`;
development CDP results alone do not establish installed acceptance.
Long TTS uses the original ordered audio-chunk consumer with
three real completed narration Jobs; failed earlier Jobs remain recorded. Windows, Catalog and public release are
NOT-VERIFIED. Development/native evidence is source-local-development, not
production trust or Windows evidence.

Business data lives at `~/Library/Application Support/SillyTavern-Nimi` on macOS
and `%APPDATA%/SillyTavern-Nimi` on Windows. It is independent of the Nimi account
and Electron Host profile. Development and installation use this same business
root; export/import character cards, chats and data backups to move to another
machine or root. Browser drafts are profile-local. Nimi uninstall does not
remove this App-owned business data.

Generation controls have an **Override Nimi resource default** checkbox. New
settings leave these overrides unset. Turning an override off keeps its saved
value; turning it on sends that value unchanged, including values a selected
resource may reject. Existing saved settings and imported presets retain their
explicit values. Tool calls and structured replies wait for a complete model
step even when streaming display is enabled; plain text can appear as generated.

## Resources

- [Upstream](https://github.com/SillyTavern/SillyTavern)
- [SillyTavern documentation](https://docs.sillytavern.app/)

## License

AGPL-3.0. Original project attribution and LICENSE are retained.

## Published Nimi dependency update — 2026-10-12

[1.19.4](https://github.com/nimiplatform/SillyTavern/releases/tag/v1.19.4) is published through the managed immutable-release workflow and [admitted to the Registry](https://github.com/nimiplatform/nimi-app-registry/pull/68). The App consumes released SDK 0.21.0, Kit/native 0.19.0, App Tools 0.12.0 and Nimi Coding 0.6.5 through public npm locks, with no local Nimi dependency override.

Chat persistence and new speech synthesis with a saved WAV result passed. These business checks used the actual Desktop-supervised development Host. Catalog AI acceptance remains NOT-VERIFIED; the user authorized publication and admission with that limitation recorded. This release declares macOS arm64.
