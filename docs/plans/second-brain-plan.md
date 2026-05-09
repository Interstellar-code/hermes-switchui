# The Construct — Lifetime Knowledge Substrate

**AKA:** Second Brain, Matrix Construct
**Status:** Architecture finalized — entering development planning phase.
**Principal:** Rohit Sharma
**Date:** 2026-05-09

## Vision

A centralized, queryable lifetime knowledge system that stores all of Rohit's accumulated data — personal, professional, business, interests, ideas — spanning the past 20-25 years and continuing forward. Accessible by Switch, all tier-2/3 agents, and external systems.

Not a research wiki (Karpathy-style at ~400K words). A **hybrid architecture** combining human-readable markdown storage with retrieval acceleration, **powered by a dedicated Hermes Agent instance** as the brain.

---

## Core Architecture — Two-Agent Model

### Overview

```
┌─────────────────────────────────────────────────┐
│              Mac Mini (Main Stack)               │
│                                                   │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐      │
│  │ Switch   │  │ Neo      │  │ Trinity    │      │
│  │ (Tier 1) │  │ (Tier 2) │  │ (Tier 2)   │      │
│  └────┬─────┘  └──────────┘  └────────────┘      │
│       │                                           │
│       │  MCP protocol                             │
└───────┼───────────────────────────────────────────┘
        │
        ▼
╔═══════════════════════════════════════════════════╗
║           THE CONSTRUCT (Docker Image)            ║
║                                                   ║
║  ┌─────────────────────────────────────────────┐ ║
║  │     Brain Hermes Agent (Dedicated Instance)  │ ║
║  │  - Own model, own config, own skills         │ ║
║  │  - Self-evolving (creates skills from work)  │ ║
║  │  - Runs scheduled tasks (ingest, lint,       │ ║
║  │    dream memory consolidation)               │ ║
║  └──────────────┬──────────────────────────────┘ ║
║                 │                                 ║
║  ┌──────────────┴──────────────────────────────┐ ║
║  │           Knowledge Layers                   │ ║
║  │                                              │ ║
║  │  Layer 1: raw/  — immutable source data      │ ║
║  │    (emails, PDFs, scans, exports, archives)  │ ║
║  │                                              │ ║
║  │  Layer 2: wiki/ — AI-compiled markdown       │ ║
║  │    (cross-linked, human-readable distillation)│ ║
║  │    (viewable in Obsidian)                    │ ║
║  │                                              │ ║
║  │  Layer 3: index/ — retrieval acceleration    │ ║
║  │    (FTS5 full-text + vector database)        │ ║
║  └──────────────────────────────────────────────┘ ║
║                                                   ║
║  Access Interfaces:                                ║
║  ┌──────────┐  ┌──────────┐  ┌──────────────┐   ║
║  │ MCP      │  │ REST API │  │ Switch UI    │   ║
║  │ Server   │  │ (HTTP)   │  │ (Chat UI)    │   ║
║  └──────────┘  └──────────┘  └──────────────┘   ║
║                                                   ║
║  Data Sources:                                     ║
║  ┌────────┐  ┌────────┐  ┌──────────────────────┐║
║  │ NAS    │  │ Scanner│  │ Upload UI (Web GUI)  │║
║  │ mount  │  │ inbox  │  │ drag & drop files    │║
║  └────────┘  └────────┘  └──────────────────────┘║
╚═══════════════════════════════════════════════════╝
```

### Agent 1: Switch (Mac Mini)

- The main orchestrator you interact with (current Hermes instance)
- Routes to tier-2 agents (Neo, Trinity, Morpheus)
- Does NOT own the second brain directly
- Queries the second brain via MCP protocol when knowledge is needed
- Keeps its context clean — no raw data processing, no index maintenance

### Agent 2: Brain Hermes (Container/VPS)

- Dedicated Hermes Agent instance that powers the second brain
- Self-evolving — creates its own skills from recurring query patterns
- Owns all three knowledge layers (raw, wiki, index)
- Runs autonomously on a schedule:
  - Ingests new data from scanner inbox, NAS, uploads
  - Compiles and updates the wiki incrementally
  - Runs lint/health checks
  - Performs dream memory consolidation (scheduled, e.g. nightly)
- Live model allocated to this agent dedicated for knowledge work

### Communication: MCP Protocol

- Brain Hermes exposes tools via MCP: `query_brain()`, `ingest_source()`, `search_knowledge()`, `get_wiki_page()`, `run_lint()`, `get_query_history()`
- Switch registers these tools at startup as a standard MCP server
- Any agent in the 3-tier hierarchy can query the brain — Neo, Trinity, Morpheus, even external coding agents (Claude Code, Cursor)
- No shared filesystem needed. Clean protocol boundary.

### Communication: REST API

- HTTP endpoint for direct access (curl, scripts, external systems)
- Supports the same operations as MCP but over HTTP
- Useful for lightweight integrations that don't need the full MCP protocol

### Communication: Switch UI (Chat Interface — "The Construct UI")

- The Construct's Docker image includes its own Switch UI instance
- Accessible at a dedicated URL/port (e.g. `http://192.168.0.72:3100` or `https://construct.rohitsharma.com`)
- You log into it directly via browser — a clean chat interface with your brain, no context mixing
- Same Switch UI you already know, pointed at the Brain Hermes instance
- Separate from your main Switch UI on the Mac Mini — two independent instances

---

## Three Knowledge Layers

### Layer 1: `raw/` — Immutable Source Data

Everything in original formats, untouched and versioned.

**Sources over time:**
- Email archives (20+ years) — exported mailboxes, IMAP sync
- Personal documents — PDFs, text files, scanned letters (via Lifeplan42 pipeline)
- Project dumps — code repositories, architecture docs, decision records
- Historical exports — past note systems, blog exports, backups
- Internet clippings — web articles, saved pages, bookmarks
- Business records — invoices, contracts, financial data
- Personal interests — health data, learning notes, ideas, journals
- Scanner inbox — physical documents digitized daily

**Rules:**
- Once written, never edited
- Source of truth for auditability
- Versioned (Git or read-only media)
- Filename convention: `YYYY-MM-DD-<category>-<description>`

### Layer 2: `wiki/` — AI-Compiled Markdown

The curated, cross-linked knowledge artifact. Written and maintained by the Brain Hermes Agent, not by Rohit.

**Structure:**
- Concept pages (one per topic, cross-linked via wikilinks)
- Entity pages (people, companies, projects, tools)
- Summary pages (monthly recaps, project statuses)
- Timeline pages (chronological lookback)

**Each page has frontmatter:**
```yaml
---
title: Entity Name
sources: [raw/2024-03-01-foo.pdf, raw/2024-03-15-bar.md]
related: [[linked-concept]], [[another-concept]]
last_updated: 2026-05-09
---
```

**Rules:**
- AI writes; Rohit reads (but can browse via Obsidian)
- Every claim traces back to its raw/ source
- Backlinks between every concept page
- Index page auto-generated

### Layer 3: `index/` — Retrieval Acceleration

**FTS5 (full-text search):**
- Indexed over both raw/ and wiki/
- Fast keyword search for known topics/terms
- Powers "light retrieval" tier

**Vector database (semantic search):**
- Embedding index over wiki pages + relevant raw chunks
- Semantic similarity search for fuzzy/conceptual queries
- Powers "medium" and "deep retrieval" tiers
- Candidate: Qdrant (validated by autholykos + Mem0 in Hermes ecosystem)

**Reranking:**
- Asymmetric retrieval: search query embedded separately from content
- Rerank top-k results for precision on deep queries

## Two Memory Systems

The Construct operates with two distinct memory systems that serve different purposes:

**1. Agent Memory (Brain Hermes's own recollection)**
- Standard Hermes memory provider configured inside the Construct's Docker container
- Candidate providers: Holographic (v1, zero-dependency) → Hindsight (v2, reflect operation)
- Stores operational learnings, not Rohit's knowledge
- Examples: "last dream consolidated 47 pages", "finance section has 3 contradictions", "query pattern X is trending — deepen wiki there"
- Makes the Brain Hermes self-improving — it learns how to be a better knowledge curator over time
- This is the agent remembering its own work history, not the data it works on

**2. Knowledge Index (The Substrate — what the agent works on)**
- FTS5 + vector index over raw/ + wiki/ — Rohit's actual stored knowledge
- This is NOT the agent's memory — it's Rohit's knowledge base, maintained and served by the agent
- Persists independently of the agent's memory, sessions, or even the agent itself
- If the agent is wiped and recreated, the knowledge index remains intact
- The agent uses it as a tool/source, not as its own recollection

---

## Query System — Intensity Tiers

### Light Retrieval
- **When:** Known topic, specific term, fast lookup
- **How:** FTS5 index lookup
- **Latency:** <100ms
- **Context cost:** Minimal — returns 1-3 relevant wiki pages

### Medium Retrieval
- **When:** Conceptual question, cross-topic query
- **How:** Vector search across wiki → rerank → inject top-k into context
- **Latency:** <500ms
- **Context cost:** Moderate — returns 5-10 chunks

### Deep Retrieval
- **When:** Complex multi-source research, synthesis, historical trace
- **How:** Vector search across wiki + raw → rerank → Brain Hermes processes with own model → returns synthesized answer
- **Latency:** 2-10s
- **Context cost:** Brain Hermes does the heavy lifting, returns only the answer

---

## Dream Memory / Consolidation

Inspired by the concept of human dreaming — a scheduled process where the Brain Hermes processes, consolidates, and refines knowledge overnight.

### What it does:

1. **Process new raw data** — ingest anything new in raw/, update affected wiki pages
2. **Cross-link discovery** — find connections between pages that were previously unlinked
3. **Contradiction detection** — flag pages that say different things about the same concept
4. **Stale info detection** — flag pages whose sources have been superseded
5. **Summary card creation** — compress completed project/work streams into compact summary pages
6. **Gap analysis** — identify topics with thin coverage and suggest new research

### Schedule:
- **Nightly:** Light consolidation — new source processing, link discovery
- **Weekly:** Deep consolidation — full lint, contradiction check, gap analysis
- **On-demand:** Triggered manually via MCP or API

### History & Audit:
Every consolidation run is logged: what was processed, what changed, what was flagged.

---

### Deployment Architecture

#### The Construct — All-in-One Docker Image

Everything contained in a single Docker image:

| Component | Purpose |
|-----------|---------|
| Brain Hermes Agent | Dedicated knowledge processing instance |
| Switch UI | Web chat UI for direct interaction with the brain |
| MCP Server | Agent-facing query protocol |
| REST API Gateway | HTTP access for scripts and external systems |
| FTS5 Index | Full-text search (SQLite) |
| Vector DB (Qdrant/Chroma) | Semantic search |
| Upload Web UI | Drag-and-drop file ingestion frontend |
| Scheduled Task Runner | Dream memory consolidation, lint, cron |
| Obsidian Vault Export | Read-only wiki/ view for Obsidian clients |

#### Deployment Targets

1. **Local**: Unraid server (192.168.0.72) — always-on on Rohit's home network
2. **Cloud**: VPS (Hetzner, Hostinger) — portable, can take the Construct anywhere
3. **Same Docker image, two targets** — identical build, just different environment configs

The Construct is fully self-contained — one `docker pull` and it runs, whether on Unraid or a cloud VPS. Persistent data (raw/, wiki/, index/) lives in Docker volumes that persist across container restarts.

### Connectivity
- **NAS mount** — read access to Network Attached Storage for historical data
- **Scanner inbox** — Lifeplan42 / LP42 MCP integration for physical document ingestion
- **Internet** — for web research, model API calls
- **Local network** — accessible by Mac Mini and other local agents

---

## Query Audit & Logging

Every query into the second brain is logged:

| Logged Field | Example |
|-------------|---------|
| Timestamp | 2026-05-09T14:32:00+02:00 |
| Querying Agent | Switch / Neo / Claude Code / Web UI |
| Query Text | "What was the agreement with Acme Corp?" |
| Retrieval Tier | Medium |
| Sources Returned | wiki/acme-corp.md, raw/2024-01-15-acme-contract.pdf |
| Response ID | uuid-v7 |

**Purpose:**
- Audit who asked what and when
- Detect query patterns (what topics are most accessed, which agents query most)
- Feed back into dream memory — frequently queried topics get deeper wiki treatment
- Track agent access patterns for security

---

## Self-Evolution

The Brain Hermes Agent has its own skill creation loop:
- When it detects a recurring query pattern, it creates a dedicated MCP tool or Hermes skill
- When it notices it processes the same type of data repeatedly, it writes an ingestion skill
- Over time, the brain develops a specialized skill library optimized for knowledge work

This is separate from Switch's skill library — the brain has its own skills focused on:
- Knowledge retrieval and routing
- Data ingestion and processing
- Health checks and linting
- Report generation and synthesis

---

## Key Design Decisions (Decided)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent model | Two-agent (Switch + Brain Hermes) | Clean separation of concerns, always-on brain, MCP communication |
| Storage | 3-layer: raw → wiki → index | Karpathy pattern + retrieval acceleration for lifetime scale |
| Retrieval | Hybrid FTS5 + Vector | FTS5 for speed, vector for semantics |
| Query tiers | Light / Medium / Deep | Match query complexity to retrieval cost |
| Deployment | Containerized (Unraid/VPS) | Always-on, independent of Mac Mini |
| Agent access | MCP protocol | Existing Hermes ecosystem, any agent can query |
| Human UI | Switch UI instance + Obsidian | Dedicated chat UI + read-only markdown browsing |
| Self-evolution | Brain Hermes creates own skills | Recurring patterns become permanent tools |
| Dream memory | Scheduled nightly/weekly | Consolidation without interrupting Switch |
| Audit | Full query logging | Traceability, pattern discovery, security |

## Key Design Questions (Open)

1. **Vector DB choice** — Qdrant, Chroma, or SQLite-vec? Qdrant has Hermes ecosystem validation (autholykos). Chroma is simpler. SQLite-vec keeps everything in one DB.
2. **Ingestion priority** — which source type first? Emails (largest historical volume), scanned docs (LP42 pipeline already exists), or internet clippings (easiest to start)?
3. **Raw storage format** — Git LFS, read-only media, or plain filesystem with snapshots? 20+ years of data needs a strategy.
4. **Brain Hermes model** — what model should the dedicated brain agent use? Retrieval + synthesis benefits from a different profile than Switch's reasoning model.
5. **Switch UI instance naming** — second Switch UI needs its own identity/branding on the dashboard to distinguish from the main one.

---

## Target Implementation Phases

### Phase 1 — Foundation
- Deploy Brain Hermes Agent container (Unraid or VPS)
- Set up MCP server for knowledge querying
- Create raw/wiki/index directory structure
- Wire FTS5 index over initial test data

### Phase 2 — Ingestion & Compilation
- LP42 scanner integration (existing pipeline feeds the brain)
- Web upload UI for manual file drops
- Wiki compilation from ingested sources (incremental)
- Obsidian vault pointing at wiki/

### Phase 3 — Query Infrastructure
- Vector database integration
- Query intensity tiers (light/medium/deep)
- Reranking pipeline
- Full query logging + audit trail

### Phase 4 — Dream Memory
- Scheduled consolidation (nightly)
- Contradiction detection / lint
- Cross-connection discovery
- Summary card compression

### Phase 5 — Agent Integration
- Switch registers brain's MCP tools
- Tier-2 agents (Neo, Trinity, Morpheus) wired to query brain
- External coding agent access
- Dedicated Switch UI chat interface for the brain

---

## Reference Comparison Matrix

| Reference | Approach | Storage Layer | Retrieval | Query Interface | Scale Target | Unique Ideas | Weaknesses |
|-----------|----------|--------------|-----------|----------------|--------------|--------------|------------|
| **Karpathy** | LLM Wiki — 3-layer plaintext | raw/ → wiki/ → schema (CLAUDE.md) | Full context load (no RAG) | Claude/LLM chat | ~400K words | Pre-computed synthesis, health checks (lint) | No retrieval layer, manual ingestion |
| **AskGlitch** | Karpathy pattern + Claude Code skills | sources/ → wiki/ → CLAUDE.md | Full context load | Claude Code skills (/capture, /sync, /lint, /digest) | Personal wiki | Skills as workflow ops, log.md session tracking | Same scaling limits as Karpathy |
| **Corey Ganim** | Hermes Agent LLM Wiki skill | Hermes built-in 3-layer (raw/wiki/schema) | Hermes LLM Wiki skill | Hermes chat + Telegram | VPS-hosted, always-on | Self-improving loop, scheduler, Telegram interface, MarkDownload clipping | Relies on Hermes' built-in wiki (limited customization), no vector layer |
| **Jsong** | Hermes + LLM Wiki on Hetzner VPS | Hetzner VPS, Hermes Agent, Telegram | Hermes built-in LLM Wiki | Telegram bot + public static site (wiki.ai-biz.app) | VPS-second brain | Public static site from wiki, full Hermes instance dedicated to brain | No vector layer |
| **autholykos** | Multi-agent pod with vector memory | Mem0 on Qdrant | Vector retrieval + MCP integration | Native MCP | Multi-agent cluster | **Qdrant + Mem0 validated** for multi-agent memory | Not a knowledge base per se |
| **rohitg00** | Cross-agent memory provider | Hybrid BM25 + vector + KG | Multiple retrieval strategies | Hermes + Claude Code + Cursor | Cross-platform agents | **Multi-strategy retrieval already built** | Memory-focused, not full knowledge base |
| **Rohit's Vision** | Hybrid lifetime knowledge substrate | raw/ → wiki/ → index/ (FTS5 + vector) | Context Mode-like hybrid (light/medium/deep tiers) | MCP server + Switch UI + Obsidian + external agents | Lifetime (20-25 yrs, terabytes) | Dream memory consolidation, query intensity tiers, containerized MCP, multi-agent queryable, dedicated brain agent | Not yet built |

## References Collected

- [Karpathy's LLM Knowledge Bases](https://antigravity.codes/blog/karpathy-llm-knowledge-bases) — The foundational 3-layer architecture
- [Build a Second Brain: Karpathy's LLM Wiki Method](https://www.askglitch.com/blog/build-a-second-brain) — Practical implementation guide with Obsidian + Claude Code
- [Karpathy LLM Wiki Pattern](https://www.mindstudio.ai/blog/karpathy-llm-wiki-knowledge-base-pattern/) — MindStudio's breakdown
- [Hermes Knowledge Browser](https://hermes-agent.nousresearch.com) — Existing LLM Wiki integration in SwitchUI
- [Context Mode MCP](https://github.com/org/context-mode) — Existing Hermes retrieval pattern (proven 2.1× faster for research tasks)
- **Corey Ganim** — *"I Built the ULTIMATE AI Second Brain (Karpathy's LLM Wiki Setup Guide)"* — [YouTube](https://youtu.be/zS3Oz0A0V38)
  - Uses Hermes Agent's built-in LLM Wiki skill as the second brain
  - Three layers: raw sources → wiki → schema/tags
  - Three operations: ingest, query, lint
  - Deploys on Hostinger VPS (one-click, always-on)
  - MarkDownload Chrome extension for web clipping
  - Proponents self-improving learning loop + built-in scheduler
  - Telegram as primary query interface
  - Key insight: Hermes already ships Karpathy's architecture built-in

- **Julian Goldie** — *"Hermes Agent: 99+ Use Cases!"* — [YouTube](https://youtu.be/6_WV1OAo2ko)
  - Walkthrough of the official 99 use cases page
  - Covers self-learning loop, persistent memory, 15+ messaging platforms
  - Highlights: personal assistants, developer workflows, content creation, business ops, research, privacy/self-hosting
  - Key lesson: a learning agent beats static AI tools — compounding knowledge over time

## Hermes Agent Use Cases — Relevant to Second Brain

Source: [hermes-agent.nousresearch.com/docs/user-stories](https://hermes-agent.nousresearch.com/docs/user-stories) — 99 stories across 15 categories

**Directly relevant (knowledge/second brain/wiki):**

| # | Who | What | Source | Key Pattern |
|---|-----|------|--------|-------------|
| 1 | Jsong (Medium) | "A self-improving LLM Wiki second brain" — built on Hetzner VPS, Hermes + Telegram, Karpathy LLM Wiki, public static site at wiki.ai-biz.app | Blog | **Closest to Rohit's vision** — already running Hermes wiki as second brain |
| 2 | NickSpisak_ | "Replaced everything with a single Hermes agent: autoresearch, Karpathy LLM wiki second brain, skills creation, scheduled jobs, background monitoring" | X/Twitter | Full-stack personal automation with wiki at center |
| 3 | rnxrx (HN) | "Memorializing and organizing important info directly into Obsidian, planning, home automation. Running on cheap VPS." | Hacker News | Obsidian as knowledge layer, VPS-hosted |
| 4 | Keith Rumjahn | "Apple Health, Threads analytics, Gmail, Calendar — Hermes = CEO, OpenClaw = Senior Engineer, both pointed at the same Obsidian vault on my NAS." | Blog | NAS-hosted Obsidian vault shared between multiple agents |
| 5 | gkisokay | "Research agent watches AI/agent space, writes briefs, suggests content angles, delivers daily via Discord, Slack, Notion, email, Obsidian, and local markdown." | X/Twitter | Multi-output research pipeline feeding into wiki |
| 6 | autholykos | "CCD multi-agent pod on M2 Ultra. Mem0 memory backend on Qdrant. Native MCP integration." | GitHub | **Qdrant + Mem0 for multi-agent memory** — vector retrieval pattern |
| 7 | rohitg00 | "Cross-agent memory: Hermes + Claude Code + Cursor. Hybrid BM25+vector+knowledge-graph search." | GitHub | **Cross-agent memory provider** — exactly the multi-agent query problem |
| 8 | @Xwm1234 | "Task-centric memory for printing factory — auto-categorizes tasks, compresses completed tasks into summary cards." | GitHub | **Dream memory pattern** — consolidation/compression of completed work |

**Patterns worth borrowing:**

- **Jsong's wiki.ai-biz.app**: Public static site generated from wiki — could be a "read" interface for Rohit's second brain
- **Keith's NAS vault**: Shared Obsidian vault on NAS accessible to multiple agents — validates the containerized MCP concept
- **autholykos's Qdrant + Mem0**: Vector DB as memory backend for multi-agent — maps to Rohit's vector index layer
- **rohitg00's hybrid BM25+vector+KG**: Cross-agent memory with multiple retrieval strategies — maps to Rohit's query intensity tiers
- **@Xwm1234's summary cards**: Compression of completed work into summaries — maps to Rohit's dream memory concept
- **@manojmukkamala's Pi 4**: "Central brain shared across all my devices" — same multi-device query goal

*More references to be added as Rohit shares them.*
