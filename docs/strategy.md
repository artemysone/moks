# Harvey.ai for Recruiting
## Vision, Strategy, and 2-Week Harness MVP

**Last updated:** August 26, 2026

---

## 1. Vision

Build the professional-class, agentic AI operating system for high-stakes talent acquisition — the equivalent of Harvey.ai in legal, but for complex knowledge-worker, technical, specialized, and executive recruiting.

**Not** another high-volume chatbot, sourcing tool, or bolted-on skills graph.  
**Yes** a domain-expert, trust-first, workflow-native platform that owns the intelligence layer and progressively owns the data layer.

### Core principles (adapted from Harvey)

- Domain expertise embedded in product, sales, and customer success
- Prestige-first land-and-expand GTM
- Workflow OS rather than chatbot
- Private knowledge (Talent Vault) + multi-step agents
- Extreme focus on accuracy, explainability, and auditability
- Privacy-by-design (no training on private candidate data by default)

### Positioning line

*"The AI-native operating system for high-stakes talent acquisition. Works with your current ATS or becomes it."*

### North star

Become the trusted operating system for high-stakes professional recruiting — where the best talent teams run their most important work, the data layer is owned or effectively controlled, and the agents compound institutional knowledge over time.

The biggest determinants of success:

1. Founding team domain credibility
2. Speed of earning trust with sophisticated TA buyers
3. Discipline in owning the system of action first, then expanding data ownership

---

## 2. Why This Is Not “Just Claude + ATS MCP”

Using Claude or ChatGPT as a harness on top of Ashby or Greenhouse MCP is a thin, ad-hoc setup. The LLM is a general-purpose reasoner that can call tools. It has:

- No persistent private Talent Vault of historical candidates, scorecards, interview notes, or firm playbooks
- No recruiting-specific agent architectures or evaluation harnesses
- No structured, multi-step workflows designed for complex professional hiring
- No domain post-training on recruiting outcomes or success signals
- No first-class compliance / bias audit / explainability product features
- No multiplayer Spaces or shared context across recruiters and hiring managers
- No Command Center focused on quality-of-hire, time-to-fill, or ROI
- No compounding institutional knowledge that stays inside the product

It is “prompt + tool calls.” Useful for one-off questions. Fragile at scale.

| Dimension | Claude/ChatGPT + ATS MCP | This product |
|-----------|--------------------------|--------------|
| Core abstraction | Chat session + tools | Req/matter-centric workspace + agents |
| Knowledge | Whatever fits in context that day | Private Talent Vault with RAG + citations |
| Agents | Generic reasoning + ad-hoc tool use | Domain-specific multi-step agents with evaluation harnesses |
| Workflows | Prompt-driven | Structured, repeatable, auditable |
| Data ownership | Read/write through MCP; data stays in ATS | Own the intelligence layer + data model; can become system of record |
| Governance | Relies on LLM client + ATS permissions | Built-in audit trails, bias monitoring, explainability |
| Collaboration | Individual chat sessions | Multiplayer Spaces, shared context |
| Compounding moat | None | Firm-specific agents, outcome data, process knowledge accumulate |

---

## 3. Strategic Positioning on the Data Layer (ATS)

### Core decision

**Progressive ownership** of the data layer rather than pure partnership or pure frontal replacement.

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| Pure layer on existing ATS | Fast GTM, low friction | Risk of becoming commoditized integration; weaker long-term moat | Avoid as end state |
| Full ATS replacement from day 1 | Full data ownership, higher ACV, stronger switching costs | Extremely high friction, long sales cycles | Too risky early |
| **Progressive ownership** | Captures data upside while preserving speed | Requires deliberate product architecture | **Chosen path** |

### Progressive ownership model

1. **Own the data model from day one**  
   First-class candidate, requisition, pipeline, scorecard, notes, and outcome objects. Do not treat external ATS as permanent source of truth.

2. **Land enterprise with deep bi-directional integration**  
   Sit above Greenhouse / Ashby / Lever / Workday Recruiting. Recruiters live in the agentic interface; structured data is written back. Existing ATS becomes a secondary system of record.

3. **Own the system of action aggressively**  
   Control matching, screening, interview intelligence, decision support, and workflow execution. High utilization creates natural pressure to expand ownership.

4. **Offer full AI-native ATS mode** where friction is lower:
   - Greenfield companies
   - Mid-market / high-growth tech
   - Professional services, RPOs, executive search firms

5. **Long-term trajectory**  
   Customers who start in layer mode can migrate fully. New customers can start fully native. Data and custom agents compound the moat over time.

### What ATS MCPs actually provide

Both Ashby MCP (open beta, all plans) and Greenhouse MCP (open beta, Core/Plus/Pro) are **controlled API surfaces designed for AI agents**. They let external agents:

- Pull live recruiting context (candidates, applications, jobs, interviews, notes, feedback, offers, etc.)
- Perform some high-value actions (especially notes and stage moves)
- Stay inside the user’s existing permission model (user-level OAuth)

They are **not** full replacement interfaces. They are the mechanism that lets a third-party agentic system sit on top of the ATS without forcing a full migration on day one — exactly the progressive ownership path.

---

## 4. Product Strategy

### MVP wedge (Months 0–9)

Focus on complex professional roles (tech, specialized knowledge work, executive).

Must-have:

- Req / matter-centric workspace
- **Talent Vault**: Secure ingestion of historical ATS data, scorecards, interview notes, firm playbooks + strong RAG with citations
- Core agents: Semantic + trajectory matching and structured screening / scorecard generation with full explainability and bias flags
- Deep bi-directional integrations with 1–2 leading ATS (start with Greenhouse or Ashby)
- Audit logs, privacy controls, basic bias monitoring
- Human-in-the-loop for high-judgment decisions

### Expansion (Months 9–24)

- JD / intake optimization agents
- Interview intelligence, prep, and debrief agents
- Offer strategy support
- Custom Agent Builder for firm-specific processes
- Command Center (quality-of-hire, time-to-fill, diversity, ROI, bias analytics)
- Broader ATS / HCM integrations
- Domain post-training on recruiting outcomes data
- Multiplayer Spaces (hiring managers + external partners)

### Technical & data principles

- Multi-model routing from day one
- Strong RAG + agent harness with evaluation benchmarks (match quality, bias metrics, citation accuracy)
- Privacy and isolation first: strong tenant isolation for Vaults
- Explicit consent and controls for any use of private candidate data
- Compliance as product feature: audit trails, NYC Local Law 144 readiness, EU AI Act high-risk considerations, explainability
- Deep system-of-record connectors treated as first-class product work
- Architecture supports both “layer mode” and “full native ATS mode”

**Data strategy:**

- Customer-provided ATS exports (permissioned)
- Synthetic recruiting trajectories
- Expert-annotated data
- Public signals (carefully, respecting ToS)
- Never train general models on private candidate data without clear rights

---

## 5. Business Model: Not an Open-Source / Free Play

The core product should **not** be open-source or free.

The Harvey model is closed, high-trust, and high-ACV because the value is not the generic LLM wrapper or the MCP connection. The value is:

- Domain-structured agents and workflows
- Private Talent Vault + compounding firm knowledge
- Explainability, auditability, and compliance posture
- Reliable system-of-action experience that recruiters actually live in
- Enterprise sales motion and trust

| Layer | Open / Free? | Rationale |
|-------|--------------|-----------|
| Thin MCP connectors / basic tool wrappers | Possibly later | Low differentiation; plumbing |
| Very basic harness scaffolding | Maybe later, selective | Can seed power-user adoption after PMF |
| Domain agents, structured outputs, evaluation, Vault, compliance, multiplayer | **Closed** | This is the product |
| Full progressive system-of-action / data ownership | **Closed** | This is the long-term moat |

**2-week speed-run harness:** Build it closed. Use it to get design partners and real usage. Do not open-source on day one.

**Longer-term product:** Stay closed and charge real money (high ACV, land-and-expand). Optional later move: open very thin connectors after paying design partners exist.

---

## 6. Go-to-Market

### Motion

Prestige-first, land-and-expand (Harvey playbook).

- **Months 0–6:** 5–10 design partners / lighthouse customers  
  Target: sophisticated enterprise TA teams (top tech, consulting, finance, law firm talent teams) and leading RPOs.  
  Discounted or free pilots for co-development, data rights, and case studies.  
  Founder + domain-expert led. Hyper-personalized demos on real requisitions (secure sandboxes).

- Sales: Domain experts selling to TA leaders / CHROs. Longer cycles acceptable if utilization and expansion are strong.

- Pricing: High ACV enterprise from the start (target $50k–$250k+ annual initially, or high seat minimums). Anchor on quality-of-hire, reduced cost-of-bad-hire, time saved on complex roles, and auditability.

- Expansion path: One team / req type → firm-wide → custom agents + deeper Vault usage. Strong net revenue retention target.

### Parallel segment

Simultaneously pursue mid-market, high-growth tech, professional services, and RPO / executive search where full native ATS mode has lower friction.

### Positioning

Complement LinkedIn rather than attack it head-on. Pursue integration partnerships with ATS leaders only when they accelerate data access and co-sell — never at the expense of long-term data ownership.

---

## 7. Team, Funding, Timeline

### Founding team

- Domain: Ex-VP / Head of TA or senior recruiter from FAANG / Big Tech, Big 4, elite executive search, or top RPO
- Technical: Strong LLM / agents / applied AI experience

**First 6–8 hires:**

- 2–3 “Talent Engineers” (ex-recruiters who deeply understand complex hiring workflows) — product, CS, and sales
- 2–3 strong engineers focused on agents, RAG, and enterprise integrations
- Security / compliance specialist (or strong fractional)
- Forward-deployed / design-partner support capacity

Domain expertise must be present in product, sales, *and* customer success.

### Funding & milestones

| Phase | Focus | Target |
|-------|-------|--------|
| Seed / Pre-seed | Founding team + design partners + MVP | 6–9 months runway |
| Series A (≈ months 9–15) | Paying lighthouse customers, utilization, quality metrics, logos | Clear PMF signals |
| Later | Scale GTM, deepen post-training, geographic expansion, outcome-based pricing | Category leadership |

**Early metrics:** pilot → paid conversion, daily active usage on core agents, time-to-shortlist or quality-of-hire lift, bias metrics, gross retention and expansion revenue.

### Timeline

| Period | Focus |
|--------|-------|
| 0–3 months | Core team, deep customer discovery, design partners, Vault + matching prototype |
| 3–9 months | Ship MVP, convert design partners to paid, refine agents + compliance, early ARR |
| 9–18 months | Expand agent surface + integrations, scale domain-led sales, Series A, begin post-training flywheel |
| 18–24+ months | Broader OS, custom agents at scale, stronger outcome pricing, category leadership |

### Key risks & mitigations

| Risk | Mitigation |
|------|------------|
| Data access & quality | Design partners with explicit rights; synthetic + expert annotation; privacy-by-design |
| Regulatory / bias liability | Compliance as core product; audit readiness; human-in-loop; transparent scoring |
| Recruiter resistance | Position as augmentation; domain experts in product/CS; measurable quality gains |
| Incumbent ecosystems | Deep integrations + differentiated Vault + agentic depth; prestige logos |
| Model cost vs value | Multi-model routing + post-training; high ACV justified by outcomes |
| Change management | White-glove implementation; Talent Engineers; clear ROI measurement |

---

## 8. 2-Week Speed-Run: Ship the Harness First

In a true 2-week speed run, ship the harness — not the full Talent Vault, not a complete multi-agent system, and not a polished product.

Ship a thin but opinionated **recruiting agent harness** that sits on top of Ashby (and/or Greenhouse) MCP and already feels meaningfully better than “just open Claude and connect the MCP.”

### What the harness means in 2 weeks

1. **Structured entry point**  
   Instead of a blank chat, the user starts from a requisition or a candidate list. The system already knows the job, the stage, and the relevant context.

2. **Domain-shaped agents (even if simple)**  
   Minimum viable set:
   - **Match / Rank agent:** Given a req + candidate(s), produce a structured fit assessment with explicit reasons and evidence pulled from the ATS.
   - **Screen / Scorecard agent:** Generate or fill a structured scorecard with citations back to notes, resume, or feedback.
   - **Pipeline summary agent:** “What needs attention on this req right now?” (stalled candidates, missing feedback, stage duration, etc.)

3. **Clean MCP + tool use layer**  
   Reliable connection to Ashby MCP (and/or Greenhouse). Read-heavy first, with a couple of safe writes (add note, move stage) behind confirmation. Permission-aware and logged.

### Explicitly out of scope for 2 weeks

- Full historical Talent Vault / sophisticated RAG
- Custom agent builder
- Multiplayer Spaces
- Bias monitoring / compliance dashboards
- Broad ATS write coverage
- Domain post-training
- Polished multi-tenant product UI
- Data migration or long sales-cycle infrastructure

### Suggested 2-week shape

**Week 1**

- Stand up the basic app shell (req-centric or candidate-centric view)
- Wire Ashby MCP (OAuth, tool discovery, basic read tools)
- Build 1–2 agents with tight prompts and structured outputs
- Hard-code a couple of real or realistic reqs so demos feel concrete

**Week 2**

- Add the scorecard / structured assessment path
- Make tool use reliable (error handling, confirmation for writes)
- Add light persistence (save assessments, notes, rankings)
- Polish the demo path so a recruiter can sit down and immediately feel the difference
- Instrument basic usage so you can see what people actually do with it

### Success criteria

A sophisticated recruiter should be able to say:

> “I can do the same work I currently do in Claude + Ashby, but faster, with better structure, and I don’t have to re-prompt the same way every time.”

If that lands, the wedge exists. Vault, richer agents, and full system-of-action ownership build on a working harness people already trust.

---

## 9. Open-Source Base: Fork OpenCode (Not Buzz, Not OpenClaw)

### Comparison

| Project | What it is | Fit for recruiting harness | License | Recommendation |
|---------|------------|----------------------------|---------|----------------|
| **OpenCode** | Mature open-source AI coding agent (TUI + desktop + IDE). Strong MCP, sessions, tool loop, primary/sub-agents, model-agnostic. | High — harness, MCP wiring, and session model transfer cleanly. Reorient domain from code → recruiting. | MIT | **Best base** |
| **Buzz** (Block) | Self-hostable multi-agent workspace (Nostr). Humans + agents in shared channels. Multiple harnesses. | Medium — interesting later for multiplayer/Spaces; too heavy for week 1–2. | Apache-2.0 | Inspiration later |
| **OpenClaw** | Personal AI assistant / multi-channel gateway (WhatsApp, Slack, etc.). | Lower — personal agent across chat apps, not a structured recruiting system-of-action. | Open source | Not the foundation |

### Why OpenCode

- Already solves the hard plumbing: agent loop, MCP client (local + remote), tool registration, sessions, permissions, structured interaction.
- Keep the harness; replace coding-centric agents/prompts/tools with recruiting ones that talk to Ashby/Greenhouse MCP.
- MIT license makes commercial use and closed derivatives straightforward.
- Matches the “thin but opinionated harness” scoped for the 2-week ship.

### Practical approach

1. Fork OpenCode (or start from a clean clone and treat it as a scaffold).
2. Strip or disable the heavy coding-specific surface.
3. Reorient the core:
   - Primary entry = req or candidate context (not a repo)
   - Pre-defined recruiting agents with tight prompts + structured outputs
   - First-class Ashby (and/or Greenhouse) MCP connection
   - Light persistence for assessments, rankings, and notes
4. Keep the product closed. Use the open-source base for speed, not as an open-source product strategy.

### What to avoid

- Don’t copy large chunks without understanding the architecture — you’ll spend more time untangling than you save.
- Don’t start with Buzz. The multi-agent channel model will slow the 2-week critical path.
- Don’t treat OpenClaw as the core runtime.

**Guiding principle:** Treat OpenCode as a high-quality **agent runtime and MCP shell**. The product is the recruiting-specific context model, agents, structured outputs, and ATS integration.

---

## 10. OpenCode Fork: Keep / Cut / Rewrite

### Keep (high leverage — don’t reinvent)

- Core agent loop and session management (creation, history, continuation, multi-session)
- MCP client (local + remote, tool discovery, tool calling, OAuth patterns)
- Agent configuration system (primary agents + subagents, per-agent prompts, model overrides, tool permissions)
- Permission / tool access model (especially important for write actions)
- Model-agnostic provider layer (cost/quality routing later)
- Config system (`opencode.json` / project + global config)
- Basic UI shell patterns (session switching, tool-call display, confirmation flows)
- Logging / observability basics (tool calls, errors, session traces)

### Cut (coding-centric or out of scope for 2 weeks)

- Default Build / Plan coding agents and their prompts
- LSP integration and language-server assumptions
- Heavy file-system / repo-centric defaults (git repo as primary unit of work)
- Code-edit tools as primary actions (keep only a tightly controlled subset if needed for scaffolding)
- Git/worktree-centric workflows as first-class product surface
- Coding-oriented subagents (Explore, Scout, etc. in current form)
- “AGENTS.md / codebase analysis on init” flows aimed at repositories
- Desktop/IDE complexity beyond the thinnest usable shell for first demos
- Community / plugin marketplace surface

Goal: strip the “this is a coding agent” identity so the product feels purpose-built for recruiting from the first interaction.

### Rewrite (this is the actual product work)

**1. Primary context model**  
From: repository / codebase  
To: **Requisition (req) or Candidate** as the central object. Everything starts from a job + stage + candidate context.

**2. Entry experience**  
From: open a project and chat  
To: select or load a req → see pipeline / candidates → invoke an agent  
Or: select a candidate → run structured assessment against a req

**3. Domain agents (replace Build/Plan)**  
- Match / Rank agent — structured fit assessment with explicit reasons + evidence  
- Screen / Scorecard agent — structured scorecard generation or completion with citations  
- Pipeline / Attention agent — “what needs attention on this req?”

Each needs tight system prompts, fixed output schemas, and clear tool access.

**4. Tool surface**  
- Primary tools = Ashby (and/or Greenhouse) MCP tools  
- Thin wrappers only where needed for better UX (e.g., “get full candidate context”, “get scorecard template”)  
- Writes (add note, move stage) behind explicit confirmation  
- Severely limit or remove general coding tools

**5. Output format & persistence**  
- Structured assessments, rankings, and scorecards as first-class objects that can be saved, revisited, and shown in a list  
- Light persistence (even simple JSON/DB) so work doesn’t live only in chat history

**6. System prompts & evaluation posture**  
- Rewrite all agent instructions around recruiting judgment, evidence, bias awareness, and explainability  
- Force structured output (JSON or clearly sectioned markdown) so the UI can render it cleanly

**7. Product framing in the UI**  
Language, empty states, and labels should say “recruiting” / “req” / “candidate” / “scorecard,” not “project” / “build” / “plan.”

### Priority order for the 2-week speed run

1. **Cut** the obvious coding surface so the codebase feels smaller and less confusing
2. **Keep** MCP + sessions + agent config intact
3. **Rewrite** the context model and one strong agent (Match/Rank or Scorecard) end-to-end
4. Wire Ashby MCP and make the happy path reliable
5. Add the second agent + light persistence
6. Polish the demo path (one real req, clear before/after vs plain Claude + MCP)

---

## 11. How the Pieces Fit Together

```
Week 0–2          OpenCode fork → recruiting harness + ATS MCP
                  (system of action starts here)

Months 0–9        Talent Vault + matching/screening agents
                  Deep bi-directional ATS sync
                  Design partners → paid

Months 9–24       Broader agent surface, custom agents,
                  Command Center, post-training flywheel
                  Progressive ownership of data layer

Long term         AI-native OS for high-stakes TA
                  Works with current ATS or becomes it
```

The 2-week harness is not a toy. It is the first visible instance of the system of action. Everything after it — Vault, compliance, full ATS mode — compounds on people already living in the product.

---

*This document reflects the research synthesis and strategic decisions as of August 26, 2026.*
