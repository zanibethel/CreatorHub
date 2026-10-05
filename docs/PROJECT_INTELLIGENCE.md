# Project Intelligence Workflow — CreatorHub

This file defines how to respond when the user asks:

> "What's new with CreatorHub?"

or a clearly equivalent request inside a CreatorHub project conversation.

It also applies when the user asks what's new with a named CreatorHub subsystem such as the trading bots, scanners, creator AI, monetization, publishing, or integrations.

## Goal

Combine current repository state, current persisted project data when available, existing open considerations, and fresh external information into a recommendation that is specific to CreatorHub.

Do **not** implement a newly proposed upgrade until the user explicitly approves it.

## Required workflow

### 1. Load current project state
Review relevant sources such as:
- `README.md`;
- `docs/THINGS_TO_CONSIDER.md`;
- current implementation/config;
- Supabase state when the question depends on persisted data;
- deployment state/logs when operationally relevant;
- recent implementation docs/commits.

For trading questions, distinguish:
- scanner observation;
- watchlist eligibility;
- bot-review eligibility;
- prepared order;
- submitted simulated/paper order;
- fill;
- live execution.

Never collapse these states.

### 2. Research genuinely new information
Use current sources appropriate to the subsystem:
- official product/framework/provider docs and changelogs;
- reputable AI/creator/platform news;
- current market/news data for trading subsystems;
- primary company/asset disclosures when a market catalyst matters;
- reputable market/crypto reporting for discovery and context.

Time-sensitive claims must be re-checked at the time of the request.

### 3. Map the update to the actual repo/data
For each finding answer:
- What changed?
- Does CreatorHub already handle it?
- Which file/table/service/bot is affected?
- Is the evidence strong enough to change behavior?
- What is the safest useful solution?
- How would we implement and verify it?

### 4. Recommendation categories
Use:
- No action;
- Monitor;
- Evaluate/backtest;
- Recommend implementation;
- Urgent fix.

For trading algorithm changes, prefer **Evaluate/backtest** until evidence demonstrates improvement.

### 5. Response shape
A "what's new?" report should normally contain:
1. **New since last review**
2. **Current project state**
3. **Impact**
4. **Possible solution**
5. **Recommended implementation**
6. **Risk/cost/evidence**
7. **Decision requested**

### 6. Approval gate
Do not modify code, schemas, deployment configuration, scanner weights, risk limits, or execution logic solely because the update looks promising.

After explicit approval:
1. re-check current implementation/data;
2. make the smallest coherent change;
3. verify with tests/data/logs;
4. update documentation and the relevant consideration status;
5. preserve before/after evidence for trading changes.

## Daily intelligence integration

When daily AI/market intelligence finds a credible CreatorHub improvement:
- append or update the matching entry in `docs/THINGS_TO_CONSIDER.md`;
- verify claims before persisting them as recommendations;
- for market items, save research context without treating news as an order authorization;
- do not silently alter the algorithm.

This file is the durable contract for the "what's new with CreatorHub?" workflow.
