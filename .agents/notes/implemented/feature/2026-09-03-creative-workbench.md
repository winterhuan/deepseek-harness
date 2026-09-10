# Agent Note: Creative workbench, bundled knowledge and skill viewer

Status: implemented

English | [中文](2026-09-03-creative-workbench.zh.md)

## Problem

Fiction, short-drama, interactive-game and video-recap workflows share source material, project files and paid production, but their original tools assume independent runtimes and dashboards. Separate implementations cannot reliably share DSH permissions, Session history, cancellation or project identity. An editor must also distinguish an unsaved draft from disk state, a preparation request from an executing job, and human-only skill browsing from model-visible skill loading.

## Decision

Creative is one four-domain plugin using DSH's existing agents, tools, filesystem, settings and jobs. The right Sidebar owns its presentation. A separate, optional read-only skill viewer inspects the Session's skill composition without invoking a tool or resuming an Agent.

<a id="composition-and-knowledge"></a>
### Composition and knowledge

[`dsh-creative`](../../../../packages/creative/creative/README.md) requires only `skills`, `subagents` and `tools`; `/creative` routes register in a separate `webServer` plus `typert` injection scope. Headless compositions retain Skills, Roles and production tools without Web services. Registrations follow plugin disposal, and no empty runtime-invariant companion is published: file, request and job checks run in the operations that authorize them.

Four bundled providers preserve distinct discovery names while sharing a release and workbench. Each `SKILL.md` owns its description and complete body; providers prepend only shared DSH integration instructions. All 36 descriptions fit the default 500-character catalog limit. Seven Roles run as `subagents.spawn` children with `maxDepth: 1` and role-specific tool filters. Roles use caller-supplied project paths and the closed `creative_bundled_reference` reader for packaged references; a workspace skill cannot shadow that reader. Author-memory receipts, chapter tracking, required references and quality checks remain part of the writing workflows. Cover generation requires an actually available image or authenticated HTTP capability, not an invented production entry.

The four providers share invocation instructions resolving workflow names and `$name` or `/name` references to `skill` loads. `creative_role` keeps its closed novel-persona enum and the inherited DSH model; ordinary `subagent` delegation directs the child to load the named Skill. Treating a stage as a novel Role would substitute different instructions and tool permissions. Research uses native web tools; browser-dependent sources return to the caller instead of requiring a fixed debugging port. Chapter retries carry specific feedback in the prompt rather than unsupported model overrides.

Knowledge manifests are descriptive catalogs of `skills`, available `roles` and `examples`, with optional adaptation notes. They contain no commit pins, schema counters, generation times, per-file hashes or mandatory change categories; loading reads packaged files independently. Git owns content history. The bundled game example uses a stable `bundled` identifier, while workspace previews retain independent filesystem digests and QA freshness checks.

Novel skills share their packaged command implementations behind skill-local CLI and import entries. JavaScript runs as ESM; missing executables, malformed findings or inconsistent exit status block chapter delivery rather than count as successful checks. Copying one novel skill directory alone does not include this shared runtime. Drama and video retain independently distributable script resources.

`browser-cdp` uses `agent-browser --engine lightpanda` for interaction and `lightpanda fetch` for one-off reads, with a named session and cleanup per task. Navigation, snapshots, form input and JavaScript extraction remain available without a DSH browser provider or CDP scraper implementation. Lightpanda supplies neither a user Chrome profile nor the visual rendering needed for game QA.

<a id="workspace-and-sidebar"></a>
### Workspace and Sidebar

One Session-level `creative` page contributes its body to `sidebar.right.pane.tab`. The right Sidebar owns placement, resizing, splitting, floating, fullscreen and visibility; Conversation retains its transcript and composer. The guide offers Creative even in an empty workspace, but creating project files does not open it automatically. `conversation/open-file` claims only recognized Creative files and delegates other paths, including line navigation, to the ordinary resource preview. Sidebar parameters and revisions carry navigation; the Session inject face consumes each tab revision once so remounts do not overwrite a later user selection.

The persistent `creative.workbench.v2` store retains buffers, conflicts, selections and production drafts. Complete listings remove clean deleted buffers but preserve dirty ones, including already-missing drafts; partial listings prove no deletion. Reads follow file versions and preserve the draft's last acknowledged CAS version. Late responses and failures cannot publish into another Session. Store creation removes legacy persisted `saving` flags; actual in-flight save locks remain Session-scoped, nonpersistent and valid across tab remounts until their requests settle.

Game and video previews load on domain entry and may restart after tab remounts. A project's first video fills an empty preview; subsequent versions require user selection. Closing the page neither cancels production nor erases drafts. Styles load through the Client module, not separately from every workbench or tool card.

<a id="project-and-file-ownership"></a>
### Project and file ownership

The [shared parser](../../../../packages/creative/creative/src/project-path.ts) recognizes root projects, direct book directories, `长篇|短篇/<book>`, standalone stories and game/video entries within supported discovery depths. Full project/episode paths address metadata, selections, drafts and asset filters; repeated `EP001` or `SHOT-001` names are not global identities. Host operations additionally enforce extension allowlists and resolved filesystem containment, including symlinks. Chapter bodies, required outlines and tracking files must belong to the same project. Post-write tracking reminders are logged model-visible context, not an unrecorded prompt mutation.

Short-story setup is visible from its first standard document because the writing skill creates settings and outlines before prose. The editor prioritizes prose and outlines for both chapter directories and standalone short-story documents.

Workspace requests accept loopback or explicitly configured `trustedHosts`, validated at load. Text saves use `FsVersion` compare-and-swap. Listings count at most 1,000 eligible creator files and set `truncated` only after observing another eligible file; exactly 1,000 files remain complete. Dependency directories, Python caches, hidden directories and video working areas consume neither this budget nor game-preview freshness. The warning does not provide pagination or make larger projects complete.

The Session filesystem provider owns media bytes. Direct Host streaming requires explicit provider mappings of the root and file before and after Host realpath resolution, with containment and size checks; matching path strings and sizes alone are insufficient. Otherwise reads use the provider, bounded to 256 MiB per media file, including Range requests. Media supports RFC 9110 byte ranges. Game previews use a script-only sandbox, CSP and distinct loopback origins; verification remains Current, Stale, Unbound or Pinned according to its source and evidence.

<a id="production-and-credentials"></a>
### Production and credentials

`creative_production` projects workbench intents and is concurrency-safe; it never edits creator documents or authorizes paid generation. A card's `ProductionRequestId`, preparation's `SessionRequestId` and execution's framework `JobId` remain distinct. Queue occurrences correlate through `rpcId`; bindings require a real Session-owned job and its `startedAt` epoch. Composition starts through the ordinary background command tool before `track_job`. Native results retain bindings in metadata and compact JSON; PTC preserves the JSON in its dispatch event. Incremental Conversation projection uses these logged results without a new history stream or Session format.

Only `jobsBySession` provides execution state after a complete `controlReady` baseline. Control loss invalidates readiness; a connection-ready notification does not discard an accepted baseline. Historical unbound requests remain requests, and unmatched jobs after a Host restart are unavailable, not completed or automatically restarted. Multiple jobs may belong to one card; ended-job counts, conversation Turns, files and estimated percentages do not establish successful planned output. Foreground results preserve exit code, timeout, signal and bounded output independently; nonzero or unknown exit codes fail production.

`creative_produce_run` executes closed drama, voiceover, recap and diagnostic entries through the DSH shell, with argument quoting, workspace resolution and sandbox policy. Missing execution services fail when called. The tool is not concurrency-safe because calls can spend money. Drama requires a prepared, explicitly confirmed `job_id` and matching adapter; replacement job JSON and extra arguments are rejected. Exactly `argv: ["--selftest"]` selects offline drama diagnostics and accepts no job, stdin or production binding. Under the project lock, `production_tool.py` checks the job and unused receipt, snapshots confirmed inputs, consumes confirmation before provider execution, validates staged outputs, publishes them and writes the ledger. Foreground and background calls share this runner. Preparation and confirmation use the same document-specific `CREATOR_SOURCE_ENTRIES` mapping, so storyboard `SHOT-` image jobs remain valid while cross-modality bindings fail.

The `creative-produce` profile stores six credential references and non-secret runtime settings; key literals belong to the credentials store. References resolve per call to canonical adapter variables: `AGNES_POOL` can supply `AGNES_API_KEY`. Secrets travel through explicit child environment and private pool stdin, not command text, model arguments or ambient `process.env`; ordinary `bash` does not opt in. Comma-separated references and newline-separated stored keys form pools. Calls rotate their starting key; one drama run receives at most sixteen distinct keys and switches only after initial-submission HTTP 401/403/429 from the same URL, explicitly tagged `submission_rejected`. Accepted requests, polling, downloads and uncertain failures never trigger automatic resubmission. The runner bounds attempts and waiting by its timeout; no outer process retry restarts it.

The production settings card stages non-secret edits together and describes all six references in one read. Responses stay associated with the reference they describe, so renaming a reference cannot publish an older result. Secret drafts start blank and blank means no write; bulk key text remains dialog-local until its explicit save. Plugin configuration seeds the profile and user settings override it. Advanced video tuning stays in validated environment options; Agnes uses the same runner, confirmation and settings ownership as the other adapters.

Agnes video resolves an unset or blank model to the free `agnes-video-2.5-flash`; explicit configuration can select the billed `agnes-video-2.5`. Under the project lock, the runner uses the adapter's request compiler on the confirmed snapshot before consuming its receipt or writing an attempt. Local model, parameter and reference errors retain their diagnostic and unused confirmation. The provider child compiles that same snapshot again, preserving the adapter stdin format at the cost of a second bounded reference read and encoding pass. Provider submission, polling and download failures retain the single-use confirmation rule.

Video calls invoke one script with one rotated key environment and Skill-enforced creator confirmation, not the drama receipt or ledger. Recap invokes executable `recap.py`, not its argument-parser module. Standalone understanding and semantic review have no dedicated credentialed entries; an analysis-only request must not start a full recap over downstream inputs, invent flags or delete work to bypass that limitation.

Stopping validates the Session owner and exact job reference before `jobs.kill`, then waits for registry state, including completion races. Withdrawal removes only the identified queue occurrence; an admitted request without a job has no stop-generation action. Stop neither cancels the conversation nor consumes output; framework kill semantics mark terminal delivery reported without injecting a model-visible success or failure. The shared [background-job display decision](2026-08-08-web-background-job-display.md) owns that non-consuming control feed.

`creative_produce_status` reports non-secret credential presence through the same profile and credential lookup as execution. It neither starts a subprocess nor consumes confirmation. A scrubbed shell environment does not describe the credential store, so Skills direct missing-key checks through this tool and configured Agnes image jobs through `creative_produce_run` with `adapter: agnes-image`.

<a id="adaptation-and-provenance"></a>
### Adaptation and provenance

Skills route novel-to-drama through the export package, novel-to-game through novel analysis and drama-to-video through `制作成果/` copies into `sources/`. A standalone short story can be read directly. The novel exporter preserves numerically ordered chapter text in `原著.txt` and writes `章节映射.json` with zero-based `[start, end)` line spans, source paths and SHA-256 hashes. Duplicate numbers, non-chapter files, missing headings and number mismatches fail rather than silently corrupt citations. Export contains text and the map, not style or tracking passthrough without a consumer.

`改编谱系.jsonl` is an append-only workspace-root ledger, written at adaptation intake with source fingerprints and decisions. Files hash by bytes; directories hash a sorted path/hash listing. Targets may not exist yet and pure delivery copies may have empty decisions. The ledger remains outside immutable, pipeline-owned `SOURCE_BIBLE`, preserving game QA evidence. There is no drama-to-game intake: adaptations of the same IP share the original novel instead of treating compressed screenplay material as game-design source.

<a id="read-only-skill-viewer"></a>
### Read-only skill viewer

[`dsh-skill-viewer`](../../../../packages/skill/skill-viewer/README.md) owns the Session-addressed `skillViewer` Remote namespace. `listDetails` returns user-invocable entries with source/provider metadata and `stale` for incomplete provider observations; `get` returns the verbatim loaded body and JSON-safe resource base. Resolution uses `sessionQuery`, the live Agent's preset-scoped registry or a cold Session's recorded-preset standing scope, with global fallback. No Agent resumes, and these human-only reads write no Session event or model context.

[`dsh-client-ui-skill-viewer`](../../../../packages/client/ui-skill-viewer/README.md) provides the sidebar-footer action and modal with per-Session successful-read caches and single-flight requests. Preset switches and connection resets invalidate caches; changing Sessions selects that Session's data. The shipped `web-app` bundle mounts both plugins, and `api-remotes` mounts the generated `skillViewer` client contribution. The composer `skills` namespace remains unchanged. The viewer has no watch, so reopening alone does not refresh changed content; browsing is not reconstructed by Session replay.

The viewer uses the available viewport height with a searchable catalog beside the reader on wide screens. Opening selects the first matching skill, and metadata remains expanded. Narrow screens show one pane with a fixed Back control. Only the catalog and reader contents scroll; the header remains visible, and selecting a skill or reference resets the reader to its start. Local files under the provider's `references/` directory open in the same reader without model tools. Host reads reject traversal, hidden paths, links and non-text content; configurable entry and byte budgets report truncation. Reference reads are cancelled when their view is left, while skill bodies and listings retain their Session caches.

<a id="localization"></a>
### Localization

Workbench chrome uses the typed `creative` locale namespace with key-identical Chinese and English fragments and explicit translator props. Plugin settings copy belongs to `settings.plugins`. The client i18n check has no Creative exemption. Production diagnostics use message keys and parameters; video stages, artifact labels and preview roles translate from codes, with a Host-label fallback for unknown video stages.

Workspace names, creator-protocol identifiers and production prompts remain zh-Hans rather than change with browser locale. Operational route errors and runtime failures remain zh-Hans until a stable error-code taxonomy supports render-time translation. Pure parsers do not localize their results.

## Alternatives considered

**Separate domain packages, upstream dashboards or external Role runtimes.** They duplicate release, route, permission, Session and cancellation ownership while adaptations cross domains. Split state slices when domain-specific lifecycle state grows, or settings namespaces when one card becomes insufficient; neither requires four applications or another server.

**Runtime skill rewrites or generated replacement workflows.** Multiple instruction owners make file edits ineffective. Shared integration text suffices without reducing professional task divisions, artifact formats or quality requirements. Novel duplication is unnecessary, but one cross-tree runtime would break independent drama/video distribution.

**Hash manifests, a manifest generator, whole-tree fork labels or Cordis vendoring rules.** None supplies runtime integrity verification for packaged knowledge; each duplicates Git or hides the small local diff in a whole-tree designation. Deleting catalogs also loses useful skill/role/example inventories. A future external downloader needs its own integrity record, not speculative manifest bookkeeping.

**A second Conversation workspace, per-file/domain Creative pages or Chat DOM reparenting.** Automatic opening and retained preview DOM offer continuity but require another layout, breakpoint and lifecycle policy. Independent pages duplicate project coordination state; DOM takeover bypasses slot mounting, scrolling and accessibility. The Sidebar supplies controls while persistent drafts, not uninterrupted previews, provide continuity.

**Persisted save locks or resetting locks on mount.** Persistence cannot prove a request survives refresh, while remount resets admit duplicate writes. Session-scoped transient locks match real operation lifetime without changing draft persistence or CAS behavior.

**Unbounded scans, a client-inferred cap or lexical-only file checks.** Recursive discovery can turn every reload into an expensive crawl; returning a count duplicates the budget in the client. Symlinks and identical remote/Host pathnames require explicit authorization independently of parsing or listing completeness.

**A second scheduler or execution inferred from prose, Turns, files or percentages.** Concurrent requests and background work make those observations ambiguous. Duplicated running-state tables invent restart recovery; logged bindings plus the existing job registry preserve intent without claiming nonexistent execution.

**Secrets in settings, shell prefixes or process-wide environment.** Settings are shared and rendered, command text is logged, and ambient mutation races Sessions and defeats credential scrubbing. Explicit credential references and per-call forwarding preserve the producing call's ownership.

**Prompt-only drama confirmation, projection as authorization or whole-run retries.** None atomically binds spending to confirmed inputs and verified publication; restarting after acceptance can spend twice. Skipping SHOT confirmation removes the creator checkpoint, duplicating keyframes in image-prompt files splits source truth, and copying the executor into a shim obscures the shared document/modality rule.

**Mandatory selection of the free model or model validation only in preparation.** A free default permits key-only Agnes setup while keeping paid selection explicit. Standalone preparation cannot inspect DSH's execution configuration; the runtime preflight sees the resolved model and confirmed bytes together. Checking only after consuming confirmation loses the receipt to an input that never reaches the provider.

**Teach the drama indexer sharded intake, guess non-numeric chapter order or extend `SOURCE_BIBLE` with lineage.** Export preserves the indexer's single-file span model and independently citable source chapters. Guessing prologue/extra order corrupts citations; support needs an explicit order manifest. Style passthrough requires a consumer, and pipeline-source immutability must not depend on unrelated adaptation bookkeeping.

**Extend the composer namespace, browse through the `skill` tool or read Host files in the client.** Composer consumers do not need viewer payloads; tool reads would create model-visible log entries for human browsing. Direct file reads bypass preset layers, custom providers and invocation policy and expose Host paths. Watch or invoke-from-viewer belongs in the viewer namespace if needed.

**Retain an i18n exemption or translate model prompts and Host errors as UI chrome.** An exemption leaves copy unowned; browser-locale prompt translation changes model behavior. Host-error translation requires stable codes rather than guessing the meaning of protocol text.

## Verification

The [Creative tests](../../../../packages/creative/creative/tests/) cover provider bodies, shared scripts, project classification, symlink and media-provider isolation, exact listing limits, draft reconciliation and disposal. The [Loader composition](../../../../packages/creative/creative/tests/loader-composition.spec.ts) proves headless registration without Web services. Video-preflight tests cover probe mapping, Python fallback and the 30-second cache; native-hook tests pin logged tracking reminders after successful prose writes and their absence after failure or denial.

[Production runner tests](../../../../packages/creative/creative/tests/produce-contract.spec.ts) execute the bundled Python path with offline fixtures, checking canonical credentials, confirmation, immutable inputs, retries and output publication. Agnes video cases cover the free default, explicit paid selection, three image references and unchanged confirmation bytes after local rejection with no attempt or network call. Storyboard confirmation also has recorded evidence from a six-case SHOT/IMG/MOTION × image/video matrix and a real prepare-to-confirm run; the complete matrix is not a committed regression suite. Exporter self-tests reconstruct chapter spans and reject invalid inputs; a 20-chapter cross-check against `novel_index.py` preserves all 20 chapters without problems. Lineage self-tests cover round trips and six invalid-input cases.

The [skill-load snapshot](../../../../snapshots/session/creative-skill-load/snapshot.yml) pins representative instructions from all four domains and offline video help through the headless profile. The [workbench Web scenario](../../../../apps/web/tests/workbench-presence.e2e.ts) compares recorded Session and final workspace output while exercising native tabs, drafts, repeated file opens, fullscreen and narrow layout. The [production Web scenario](../../../../apps/web/tests/creative-production.e2e.ts) covers Native/PTC bindings, multiple jobs, repeated project-local IDs, unrelated Turns, reload, targeted stop and Host restart. Its [job normalization](../../../../packages/test-support/session-snapshot/src/production-jobs.ts) preserves identity/epoch relationships without rewriting arbitrary prose.

The [viewer Host tests](../../../../packages/skill/skill-viewer/tests/) include real Loader composition and disposal; [client tests](../../../../packages/client/ui-skill-viewer/tests/) exercise registration, the panel and Session-scoped request caching. Locale checks verify dictionary parity and the absence of a Creative exemption.

A recorded macOS x86_64 smoke with `agent-browser 0.37.0` and `Lightpanda 1.0.0-nightly.9231+b21ec6085` covers Markdown extraction, snapshots, Chinese input, clicks, selector waits, stdin/base64 JavaScript, cross-page Cookie/localStorage retention and fresh state after close/reopen. HTTPS extraction succeeds; HTTP 404 with `--fail-on-http-error` exits 22; Chrome profiles are rejected. `agent-browser 0.26.0` times out during connection with the same engine, so recognizing `--engine` is not compatibility proof. That smoke isolates downloads and sessions without changing user Chrome or global installations.

## Consequences

Creative uses one DSH composition and the existing Session format. Model-visible Skills, Roles, tools and post-write reminders remain logged; human-only viewer reads deliberately do not. Knowledge and the bundled game demo increase clone and package size; on-demand distribution remains possible without changing provider discovery.

Remote filesystem reads do not stage packaged scripts into a remote shell: deployments must mount or copy those resources. Sidebar tab lifetime does not preserve preview runtime. A cancelled or interrupted drama run may leave a consumed receipt and unresolved running ledger state; neither that receipt nor an unmatched process-local job is automatically reused or restarted.

Video still has Skill-enforced confirmation rather than the drama receipt/ledger. Non-numeric chapter ordering, style passthrough and viewer watches remain absent. Provider fixtures and Session replays do not establish live availability, billing behavior, site-specific browser compatibility or generated-media quality; the browser-instruction snapshot does not execute browser automation or complete creative workflows.
