# CreatorHub ↔ CoOperative AI — Live Capability Parity and Personal Nodes

**Product decision:** 2026-10-19, recorded for review; **documentation only**. This is a shared CreatorHub-wide capability contract, not just an AI Clipper subfeature.

**User goal:** The AI integrated into CreatorHub should feel and behave like the AI available at **cooperative.chat**, including the same evolving model routing, Model Mixer controls, connected/owned and **personal node** choices, media capabilities, and transparent job/cost feedback wherever the relevant capability is actually available.

**Source of truth:** CoOperative's authorized current runtime/capability registry and published server API contracts, *not* an independent imitation or frozen fork of the CoOperative UI. Review deployed runtime separately from repository code before claiming any feature is live or available. The cooperative.chat website itself was not independently verified during this documentation review; requirements below are grounded in repository code/docs.

**Relationship to CreatorHub Clipper:** Every authorized video job must use the *same* governed CoOperative routing layer for tasks that actually require AI (transcription, highlights, titles, captions, quality review), plus appropriate authorized render workers for deterministic FFmpeg operations. A connected node's actual capabilities determine which stages it can perform.

## Experience to mirror within CreatorHub

1. **One embedded AI experience** throughout CreatorHub, using the current CoOperative capability/router services and respecting the active CreatorHub workspace. Don't ask creators to maintain a second chat, copy API endpoints, paste external plugin/MCP instructions, or configure a separate model provider merely to use core functions.
2. **Code-first and playbook-first:** execute validated CreatorHub actions deterministically first; call an AI model for genuinely ambiguous reasoning, generation, vision, audio, or video stages.
3. **Model Mixer parity:** offer CoOperative's currently supported Auto/Economy/Balanced/Premium (and expert Custom where allowed), task-level research/planner/builder/verifier/media controls, node route preference, budget ceiling, and explicit paid-fallback permission. Expose only controls truly honored by the runtime, never cosmetic placeholders.
4. **Personal/owned node routing:** if a creator explicitly links a capable CoOperative personal PC/phone/local node (or an authorized business node), CreatorHub can discover its **allowed capabilities and live availability** and prefer it *for that creator's jobs*. Require online heartbeat, verified capability, workload permissions, privacy policy, resource availability, and capacity. Don't assume every personal node can do transcription, FFmpeg rendering, vision, or video.
5. **Node modes:** Auto/prefer-owned uses authorized suitable local nodes first, then approved private/platform/community/free execution, and paid only within explicit per-job budget and account funding permissions. **Require this node** must fail or wait clearly when that specific node is offline/inadequate—**no silent fallback to cloud**, even a free cloud model. A user's existing personal node is not a pooled commercial resource without consent.
6. **Meaningful routing UI:** display (when safe) selected node/model, local/free/paid tier, queued/running/completed/failed state, retry/fallback reason, estimated maximum user charge before spending, and actual charged amount after reconciliation. Don't expose other users' nodes, credentials, raw infrastructure costs, or private task data.
7. **Continuity and reliability:** preserve per-creator conversation context, preferences, attachments, approved reference media, job history and replay/retry semantics. Durable asynchronous queues are required for heavy audio/video work. A reconnect or node failure must not duplicate jobs, double-charge, or lose authorized outputs.
8. **Evolving parity:** when CoOperative adds or retires a model, worker profile, routing policy, capability, or pricing rule, CreatorHub should consume the versioned supported contract and surface the change if relevant; avoid hard-coded duplicate catalogs or provider-specific routing logic. Platform-specific UI can remain CreatorHub branded.

## Current repository evidence and known gap

As reviewed 2026-10-19:
- CoOperative main chat at `app/api/local-ai/chat/route.ts` accepts `nodeRouting` (`default`, `prefer-owned`, `require-node`), optional `requiredNodeId`, `modelMixer` preset/agent controls and per-request spend limits. Main chat has code-first routing and funded paid fallback gates. `app/local-ai/ModelMixer.tsx` contains the richer mixer interface and model registry/catalog state.
- `lib/unison/owned-text-routing.ts` filters nodes by *authorized access*, capability, policy, health/heartbeat and state. `docs/UNISON.md` describes private, operator and community tier preference. `app/api/personal-ai/chat/route.ts` uses a *strict personal-node* route that does not silently enable cloud.
- CreatorHub already has a working **foundational CoOperative integration**: `src/app/api/cooperative/chat/route.ts`, `src/app/api/cooperative/escalation/route.ts`, `src/components/CreatorHubAiBubble.tsx`, image router / CoOperative image jobs, and CreatorHub context-aware deterministic actions. Do not build a duplicate integration without inspecting or reusing this.
- **Identity mismatch to resolve:** CoOperative's main chat typically identifies a profile as `coop-user:<userId>`, while its CreatorHub bridge at `app/api/integrations/creatorhub/chat/route.ts` builds a distinct owner reference `creatorhub:<userId>:<creatorId>`. That bridge currently selects Fast/Quality itself rather than transparently using the entire main-chat mixer / profile-node routing contract. **Do not assume those owner IDs are equivalent or that a CreatorHub login automatically inherits node rights.**
- This review establishes source-code capability, **not** verification that every function, node, price, account link, or feature is currently active on the deployed cooperative.chat service or CreatorHub production.

## Security and privacy: non-negotiable

- Add a **verified account linking / federation** mechanism where required so an authenticated CreatorHub user can explicitly link their corresponding CoOperative profile. Use short-lived, signed, audience-scoped assertions or an approved consent flow, not a browser-supplied CoOperative user ID or an unvalidated matching email. Preserve the mapping and revocation as owner-controlled records.
- Verify the CreatorHub session **and creator/workspace ownership** at its server. Have CoOperative independently verify trusted service authentication **plus** the signed subject, grants, expiration, scope and target node ownership. Service shared secrets are *not* proof that an arbitrary user owns an arbitrary node.
- Personal nodes may process only tasks of their authorized user/workspace/consenting linked accounts. Never expose credentials, full private histories, sensitive cross-tenant context, or node enrollment credentials to another account.
- Honor node opt-in, offline/pause mode, idle-only restrictions, permissions, task content policy, compute caps and secure short-lived attachment access. Distinguish a profile's personal node from any separate **opt-in** community contribution capacity.
- Per-profile routing policy and paid usage must not silently debit another identity's CoOperative wallet or bypass CreatorHub's own billing/usage limits. Cross-system funding rules and cost ownership require an explicit accounting contract, especially before selling this as a SaaS feature.
- Graceful fallback only according to user settings; a strict local/personal node selection blocks all unapproved remote inference. Show an actionable unavailable state, not a fabricated successful response.
- Keep processing provenance: source creator account, linked CoOperative identity, node selected, capability evidence, model version, job ID, policy version, cost reservation, actual billable usage and whether fallback was authorized.

## CoOperative routing contract for Clipper stages

| Work stage | Preferred route | Required capability / boundary |
| --- | --- | --- |
| URL parsing / channel search / permissions | CreatorHub deterministic code and platform APIs | No AI needed; YouTube platform quota rules still apply. |
| Transcription / speaker timing | A capable authorized user's node, then permitted alternatives | Verified audio speech-to-text + time alignment; no unapproved external audio transmission. |
| Highlight, hook, titles/captions | CoOperative model router; capable user-owned models first | Task-specific text/context capability, benchmark floor, cost ceiling and verification. |
| Face/speaker framing | Capable authorized media/vision worker | Must report supported video/vision/frame-tracking capabilities; text-only phone nodes are not suitable. |
| FFmpeg cutting, captions and exports | Available authorized render worker, local-first where capable | CPU/GPU/storage, signed media access, job leases/timeouts, dedupe and resource/idle policy. |
| Quality checks / publishing preparation | Cheapest qualified deterministic checks plus AI where useful | Real output readiness and platform format validation before showing “ready.” |

## One-pass-at-a-time verification plan — AI parity track

**This is a proposed parallel track**; it does not replace the currently queued **Clipper Pass 1 (YouTube quotas)**. Start exactly one scoped pass on an explicit future “continue” / “ok go,” confirm which track before assuming a switch, and stop after each PR. No implicit merge, migration, or deploy.

| AI pass | Change boundary | Required review evidence |
| --- | --- | --- |
| **AI-A — Live contract audit** | Compare deployed CoOperative endpoints, code, capability registry, current CreatorHub bridge and identity/access maps; publish gap checklist. No routing change. | Proven supported endpoint/fields, secure authentication design, exact UI capability matrix; stop. |
| **AI-B — Profile linking** | Implement secure CreatorHub↔CoOperative account mapping/grants and revocation; no model-reroute UI. | Cross-account denial, scope checks, node ownership tests, linked/unlinked cases; stop. |
| **AI-C — Node availability & routing** | Add signed per-profile node discovery and allowed node route modes to CreatorHub bridge; preserve code-first logic. | Known healthy/offline/incapable/paused node, node-only no-cloud guarantee, fallback consent; stop. |
| **AI-D — Shared Model Mixer & spend policy** | Surface runtime-approved mixer tiers, per-agent controls and quotes via versioned CoOperative capability APIs. | Feature-flag/routing parity tests, execution-time prices, reserve/settle/deny, no stale cost surprise; stop. |
| **AI-E — Clipper worker adaptation** | Route transcript/highlight/media/render jobs to qualified personal/private nodes and governed alternatives by stage. | Real media outputs, worker capability & timeouts, tenant isolation, cost reconciliation; stop. |
| **AI-F — Ongoing parity checks** | Contract/schema tests + simple user-facing node/provider status and graceful degradation. | Detect CoOperative capability changes without breaking CreatorHub and verify prod parity separately; stop. |

## What this document does NOT implement

No new node enrollment, user account linking, cross-app identity permissions, Model Mixer UI, entitlement transfer, automatic job dispatch, YouTube media downloading, paid execution, or production changes. Those remain **separately approved, reviewable passes**, using existing modules as the starting point.

Related repository context: CoOperative `docs/UNISON.md`, `docs/CODE-FIRST-CHAT.md`, `docs/AI-RUNTIME-CONTEXT.md`, `docs/AI-ESCALATION.md`; CreatorHub `docs/PLATFORM_GOALS.md` and `docs/AI_CLIPPER_PRODUCT_AND_QUOTA_PLAN_20261019.md`.
