# The Construct — Implementation Plan

Based on: `docs/plans/second-brain-plan.md` (architecture document)
**Type:** Private GitHub repo + Docker image + MCP server
**Stack:** Hermes Agent + Switch UI + FTS5 + Vector DB

## 1. Repo Setup

**Location:** `/Volumes/Ext-nvme/Development/the-construct`
**Remote:** `Interstellar-code/the-construct` (private repo)
**Convention:** Same pattern as other local projects (lifeplan42, operator1, etc.)

### Step 1.1 — Create repo structure

```
the-construct/
├── README.md
├── Dockerfile
├── docker-compose.yml          # local dev + Unraid deployment
├── docker-compose.cloud.yml    # VPS deployment (different env vars)
├── .env.example
├── .dockerignore
├── .gitignore
├── AGENTS.md                   # Hermes project context
│
├── agent/                      # Brain Hermes Agent config
│   ├── config.yaml             # hermetic config for the brain agent
│   ├── SOUL.md                 # The Construct's identity
│   └── skills/                 # Pre-installed second brain skills
│       ├── capture.md
│       ├── query.md
│       ├── lint.md
│       └── dream-memory.md
│
├── construct/                  # Custom services (Node/Python)
│   ├── mcp-server/             # MCP server exposing brain tools
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts        # MCP server entry point
│   │   │   ├── tools/
│   │   │   │   ├── query.ts    # query_brain(), search_knowledge()
│   │   │   │   ├── ingest.ts   # ingest_source(), upload_file()
│   │   │   │   ├── wiki.ts     # get_wiki_page(), list_pages()
│   │   │   │   ├── audit.ts    # get_query_history(), audit_log()
│   │   │   │   └── admin.ts    # run_lint(), trigger_dream_memory()
│   │   │   └── lib/
│   │   │       ├── fts5.ts     # FTS5 index operations
│   │   │       ├── vector.ts   # Vector DB client
│   │   │       └── audit.ts    # Query logging
│   │   └── package.json
│   │
│   ├── upload-ui/              # Web GUI for file uploads
│   │   └── index.html          # Simple drag-and-drop page served by Hermes
│   │
│   └── scripts/                # Scheduled task scripts
│       ├── dream-memory.py     # Nightly consolidation
│       ├── wiki-compile.py     # Incremental wiki compilation
│       ├── lint.py             # Health check / contradiction detection
│       └── ingest-scanner.py   # LP42 scanner mailbox integration
│
├── data/                       # Persistent data (Docker volume)
│   ├── raw/                    # Immutable source documents
│   ├── wiki/                   # AI-compiled markdown
│   ├── index/                  # FTS5 + vector indexes
│   └── audit/                  # Query logs
│
└── docs/
    ├── index.md                # Construct documentation index
    ├── architecture.md         # Architecture overview
    ├── setup.md                # Quick start guide
    ├── agent-integration.md    # How agents connect via MCP
    └── deployment.md           # Deployment to Unraid / VPS
```

### Step 1.2 — Create GitHub repo

```bash
cd /Volumes/Ext-nvme/Development
mkdir the-construct
cd the-construct
git init
gh repo create Interstellar-code/the-construct --private --source=. --remote=origin --push
```

---

## 2. Docker Build

### Step 2.1 — Dockerfile

Multi-stage build:
1. **Base:** Hermes Agent official image (`nousresearch/hermes-agent` or `outsourc-e/hermes-agent`)
2. **Build stage:** Compile MCP server TypeScript, install Python deps
3. **Runtime:** Hermes Agent + MCP server + Switch UI + custom scripts

```dockerfile
# Stage 1: Build MCP server
FROM node:22-alpine AS mcp-builder
WORKDIR /app
COPY construct/mcp-server/package.json ./
RUN npm install
COPY construct/mcp-server/ ./
RUN npm run build

# Stage 2: Main image
FROM outsourc-e/hermes-agent:latest

# Install Node.js for MCP server
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*

# Copy MCP server
COPY --from=mcp-builder /app/dist /opt/construct/mcp-server
COPY --from=mcp-builder /app/node_modules /opt/construct/mcp-server/node_modules

# Copy Construct services
COPY construct/ /opt/construct/
COPY agent/config.yaml /home/hermes/.hermes/config.yaml
COPY agent/SOUL.md /home/hermes/.hermes/SOUL.md
COPY agent/skills/ /home/hermes/.hermes/skills/

# Copy Switch UI
COPY --from=switchui-builder /app/.output /opt/switchui

# Entry point: start Hermes Agent + MCP server + Switch UI
COPY docker-entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

### Step 2.2 — docker-compose.yml

```yaml
version: "3.8"
services:
  construct:
    build: .
    image: interstellar/the-construct:latest
    container_name: the-construct
    ports:
      - "3100:3000"   # Switch UI (chat interface)
      - "3101:8642"   # Hermes Agent gateway
      - "3102:8650"   # Custom MCP server
      - "3103:8080"   # Upload web UI
    volumes:
      - construct_data:/app/data
      - construct_raw:/app/data/raw
      - /mnt/nas:/mnt/nas:ro   # optional NAS mount for historical data
    environment:
      - HERMES_PASSWORD=${CONSTRUCT_PASSWORD}
      - LOG_LEVEL=info
      - CONSTRUCT_MODE=production
    env_file:
      - .env
    restart: unless-stopped

volumes:
  construct_data:
  construct_raw:
```

---

## 3. Phase-by-Phase Implementation

### Phase 1 — Foundation (Week 1)

**Goal:** Deployable Docker image with MCP server, queryable FTS5 index.

| Task | What | Depends On |
|------|------|-----------|
| 1.1 | Create repo structure + push to GitHub | Nothing |
| 1.2 | Write Dockerfile + docker-compose.yml | 1.1 |
| 1.3 | Build FTS5 MCP server (query + search tools) | 1.1 |
| 1.4 | Set up data directory structure (raw/wiki/index) | 1.2 |
| 1.5 | Deploy on Unraid, test MCP connectivity from Switch | 1.2, 1.3 |
| 1.6 | Seed initial test data into raw/, verify FTS5 indexing | 1.4, 1.5 |

**Success criteria:** Switch can call `construct_query("search term")` and get results from the Construct's FTS5 index.

### Phase 2 — Ingestion (Week 2)

**Goal:** Automated data ingestion from multiple sources.

| Task | What | Depends On |
|------|------|-----------|
| 2.1 | Web upload UI (drag-and-drop files into raw/) | 1.5 |
| 2.2 | LP42 scanner pipeline integration (ingest scanned docs) | 1.5 |
| 2.3 | MarkDownload/Telegram clipping pipeline | 1.5 |
| 2.4 | Wiki compilation service (raw/ → wiki/ incremental) | 2.1-2.3 |
| 2.5 | Obsidian vault pointing at data/wiki/ | 2.4 |

**Success criteria:** Scanner document arrives → Construct ingests it → wiki page created → observable in Obsidian.

### Phase 3 — Query Infrastructure (Week 3)

**Goal:** Vector search + query intensity tiers + full audit logging.

| Task | What | Depends On |
|------|------|-----------|
| 3.1 | Vector DB integration (Qdrant or Chroma) | 1.5 |
| 3.2 | Embedding pipeline (wiki pages → vector index) | 3.1 |
| 3.3 | Query intensity tiers (light FTS5, medium vector, deep synthesis) | 3.2 |
| 3.4 | Reranking pipeline | 3.3 |
| 3.5 | Full query audit logging (who, what, when, results) | 1.3 |
| 3.6 | Audit dashboard (pattern discovery, agent tracking) | 3.5 |

**Success criteria:** "Medium" query returns semantically relevant results from across the wiki. Query log shows every agent's access pattern.

### Phase 4 — Dream Memory (Week 4)

**Goal:** Scheduled knowledge consolidation and health checks.

| Task | What | Depends On |
|------|------|-----------|
| 4.1 | Dream memory script (nightly consolidation) | 2.4 |
| 4.2 | Lint/health check script (weekly contradiction detection) | 2.4 |
| 4.3 | Cross-connection discovery (unlinked related pages) | 3.2 |
| 4.4 | Summary card compression (completed work → compact pages) | 4.1 |
| 4.5 | Cron scheduling (nightly + weekly + on-demand) | 4.1-4.4 |

**Success criteria:** Every morning, the Construct has processed new data and refined its wiki. Weekly lint report surfaces contradictions and gaps.

### Phase 5 — Switch UI Integration (Week 4-5)

**Goal:** Dedicated chat UI + full agent integration.

| Task | What | Depends On |
|------|------|-----------|
| 5.1 | Switch UI instance with "Construct" branding | 1.2 |
| 5.2 | Register Construct MCP tools in Hermes config.yaml | 1.5 |
| 5.3 | Switch (tier-1) integration — query brain before knowledge tasks | 5.2 |
| 5.4 | Tier-2 agent integration (Neo, Trinity, Morpheus query brain) | 5.2 |
| 5.5 | External agent access (Claude Code, Cursor via MCP) | 5.2 |

**Success criteria:** You can chat with the brain via `http://192.168.0.72:3100`. Switch auto-queries the brain for relevant context. Neo asks the brain before starting technical work.

---

## 4. MCP Tool Surface (Brain → Agents)

The Construct exposes these tools via MCP. Switch and all tier-2 agents register them at startup.

### Query Tools

| Tool | Params | Returns | Tier |
|------|--------|---------|------|
| `construct_light_search` | query: str, topic?: str | 3-5 wiki page titles + summaries | Light |
| `construct_medium_search` | query: str, top_k?: int | 5-10 relevant chunks with source refs | Medium |
| `construct_deep_query` | query: str, include_raw?: bool | Synthesized answer with sources | Deep |
| `construct_get_wiki_page` | path: str | Full wiki page markdown | — |
| `construct_list_topics` | — | All wiki topics with page counts | — |

### Admin Tools

| Tool | Params | Description |
|------|--------|-------------|
| `construct_ingest_file` | path: str, category?: str | Add file to raw/, trigger wiki update |
| `construct_ingest_url` | url: str | Clip web page into raw/ |
| `construct_run_lint` | — | Run health check, return report |
| `construct_trigger_dream` | mode: "light" \| "full" | Trigger consolidation now |
| `construct_query_history` | agent?: str, since?: date | Audit log of queries |

---

## 5. Integration with Main Stack

### Hermes config.yaml (on Mac Mini)

```yaml
mcp_servers:
  construct:
    url: "http://192.168.0.72:3102/mcp"
    headers:
      Authorization: "Bearer ${CONSTRUCT_API_KEY}"
    timeout: 120
```

No changes to Switch's SOUL.md needed — the tools auto-discover. Switch automatically queries the Construct when it needs knowledge context.

### For Tier-2 Agents (Neo, Trinity, Morpheus)

Each agent's config.yaml on the Mac Mini adds the same MCP server entry. They get the same tools. A Neo session can call `construct_medium_search("networking")` and get the same results Switch would.

---

## 6. Key Decisions Made

| Decision | Choice | Why |
|----------|--------|-----|
| MCP protocol | StreamableHTTP | Standard Hermes MCP, works across machines |
| Vector DB | Qdrant (validated) | autholykos + Mem0 prove it works in Hermes ecosystem |
| FTS5 | SQLite FTS5 | Already proven in Context Mode MCP |
| Auth | Bearer token + env file | Simple, secure, standard |
| Wiki format | Markdown + frontmatter | Obsidian-compatible, LLM-friendly |
| Scheduled tasks | Hermes cron inside the Construct | Leverages existing scheduler |
| Upload UI | Simple HTML page served by Hermes | Minimal overhead, drag-and-drop |

---

## 7. URLs & Ports (Local Unraid)

| Service | URL | Port |
|---------|-----|------|
| Switch UI (chat) | http://192.168.0.72:3100 | 3100 |
| Construct Hermes Gateway | http://192.168.0.72:3101 | 3101 |
| Construct MCP Server | http://192.168.0.72:3102/mcp | 3102 |
| Upload Web UI | http://192.168.0.72:3103 | 3103 |

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 20+ years of data too large for Docker volume | Medium | High | Use NAS mount for raw/, Docker volume for wiki/index only |
| Embedding costs for vector index | Medium | Medium | Use local embedding model (e.g. MiniLM-L6) or batch schedule |
| FTS5 slow on large corpus | Low | Low | Partition by year, query with date filters |
| Brain Hermes agent tokens competing with Switch budget | Low | Medium | Brain uses cheaper model (MiniMax / local) than Switch (Opus) |
| MCP connection drops across machines | Low | Low | Native MCP client auto-reconnects (exponential backoff) |
