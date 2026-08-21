# COMPANY.md — Northline Analytics (company constitution)

## About
Analytics platform, ~120 people, currently staffing the payments-infra rewrite.
Reqs live in subdirectories; each has its own HIRING.md + candidates/. A req
HIRING.md overrides this file for its packet.

## How we hire
Stages: sourced → screen → phone → onsite → offer → hire. Recruiter screens
against the scorecard; the hiring manager owns the onsite decision.

## Bar
- Strong fundamentals over framework familiarity
- Evidence of ownership: shipped and operated real systems
- Each req's HIRING.md carries the role scorecard the agent screens against

## Comp
Bands live on each req. Never state comp in outreach.

## Tone & outreach
Warm, specific, no buzzwords. 2 short paragraphs max. Follow-ups: max 2,
spaced 4 business days.

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
