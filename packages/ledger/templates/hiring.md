# hiring.md — Senior Backend Engineer (REQ-142)

## Role
Staff-leaning senior backend engineer, payments team. JD: ./jd.md

## Bar
- 5+ yrs backend; strong distributed-systems fundamentals
- Payments/fintech exposure preferred, not required
- Scorecard: ./scorecard.md (agent screens against this)

## Comp
Band: $185k–$225k base + 0.05–0.15%. Never state comp in outreach.

## Tone & outreach
Warm, specific, no buzzwords. 2 short paragraphs max. Always mention
the payments-infra rewrite. Follow-ups: max 2, spaced 4 business days.

## Policy
auto_approve: [AddNote, AddTag]   # reversible only; irreversible/compensable never auto-approve
batch_review: [AdvanceStage]
always_gate: [SendOutreach, Reject, ExtendOffer]
reject_sampling: 10%   # % of agent-proposed rejects flagged for human audit
# Optional tool-level permission map (uncomment to use). Values: allow | ask | deny.
# Tools: workspace_read, list_applications, ledger_status, ledger_list, ledger_diff,
# ledger_commit, sync_pull, source_search. ledger_commit(Mutation) scopes a rule to
# one mutation; a bare tool key is the wildcard fallback. Precedence: most specific
# wins (ledger_commit(AddNote) beats ledger_commit); deny always wins and soft-fails
# the tool call; allow only takes effect for reversible mutations — on compensable or
# irreversible ones (e.g. SendOutreach, ExtendOffer) it degrades to ask. Tools or
# mutations with no matching rule keep the effect-class + policy-list behavior above.
# permissions:
#   source_search: deny
#   ledger_commit(AddNote): allow
#   ledger_commit(SendOutreach): deny
#   ledger_commit: ask
