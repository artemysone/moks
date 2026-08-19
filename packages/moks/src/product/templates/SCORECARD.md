# Scorecard — Senior Backend Engineer (REQ-142)

Agent screens against this. Scale is 1–4. Bar is 3 on every dimension except payments exposure, which is preferred, not required.

| Score | Meaning |
| --- | --- |
| 1 | Well below bar |
| 2 | Below bar |
| 3 | At bar |
| 4 | Above bar |

Advance only with no 1s, every other dimension ≥ 2, and an average ≥ 3. A payments score of 2 is acceptable when distributed systems, backend depth, and communication are all ≥ 3.

## Distributed systems

**Bar (3):** Designs and reasons about distributed systems in production — consistency, failure modes, backpressure, and operational tradeoffs — without treating the network as reliable.

- **1 — Well below:** Talks about services as if they were local function calls. No vocabulary for partitions, retries, or idempotency.
- **2 — Below:** Has used queues or caches but cannot explain failure modes or why a design is safe under retry and timeout.
- **3 — At bar:** Walks a real system through partition, retry, and dual-write failure. Chooses consistency vs. availability with a reason. Knows when to use outbox, idempotency keys, and backpressure.
- **4 — Above:** Has owned hard distributed problems (exactly-once-ish pipelines, multi-region, consensus-adjacent) and can teach the tradeoffs.

## Backend depth

**Bar (3):** Ships and operates substantial backend systems. Strong in data modeling, API design, and production debugging. Matches the 5+ years backend bar in `hiring.md`.

- **1 — Well below:** Mostly CRUD wrappers; thin on modeling, indexing, or operational ownership.
- **2 — Below:** Solid application code but shallow on storage, concurrency, or how the system behaves under load.
- **3 — At bar:** Designs APIs and schemas that hold up. Reasons about transactions, indexes, and tail latency. Debugs production from first principles.
- **4 — Above:** Staff-level depth — sets conventions, simplifies complexity, and leaves systems others can operate.

## Payments exposure

**Bar (3):** Has worked near money movement, ledgers, or financial correctness. Preferred, not required — a 2 does not fail the screen if the other three dimensions are at or above bar.

- **1 — Well below:** No exposure to money, ledgers, or correctness-sensitive systems; treats payments as a third-party checkbox.
- **2 — Below / adjacent:** Adjacent correctness work (billing, inventory, marketplace settlement) but not payments or fintech. Acceptable if other dimensions carry.
- **3 — At bar:** Has shipped or operated payments, ledger, or fintech systems. Understands idempotency, reconciliation, and why money bugs are different.
- **4 — Above:** Deep payments or ledger ownership — reconciliation, audit trails, PCI-adjacent constraints, or similar.

## Communication

**Bar (3):** Writes and speaks with precision. Can explain a design, a tradeoff, and a no. Outreach and notes should match the `hiring.md` tone: warm, specific, no buzzwords.

- **1 — Well below:** Vague, buzzword-heavy, or unable to structure an answer.
- **2 — Below:** Understands the work but cannot make the reasoning inspectable to a hiring manager or future teammate.
- **3 — At bar:** Clear, specific, no theater. Written notes and verbal walkthroughs would survive review.
- **4 — Above:** Teaches while talking. Compresses complexity without losing the load-bearing details.
