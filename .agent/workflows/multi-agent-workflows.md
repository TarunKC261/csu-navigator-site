# Workflow: Add an Agent to a Multi-Agent Workflow

## Purpose
Extend a **multi-agent workflow** site with a new agent and at least one
transition into or out of it. A workflow is a graph of agents — each with its
own prompt, voice, KBs, and tools — connected by transitions that the LLM (or
the frontend) can follow during a single voice session.

## When to use this guide

Use this when the site's `platform.yaml` has a `workflow:` block at the top level.

If you see `agent:` (singular) at the top level, this is a **single-agent**
site — not a workflow. To add behavior there, see `create-site-function.md`
(for frontend functions the agent can call) or just edit `agent.prompts.speakLlm`
to extend the prompt. Do **not** mix `agent:` and `workflow:` in the same
`platform.yaml` — they are mutually exclusive and validation will reject files
with both.

Workflows require `sceneGeneration.brainMode: ONE_BRAIN`. Two-brain sites must
switch to one-brain mode before assigning a workflow.

---

## Architecture Overview

```
            ┌──────────── platform.yaml ────────────┐
            │ workflow:                         │
            │   entry: intake                   │
            │   agents:  [intake, support, …]   │
            │   transitions: [intake → support, …]
            └───────────────┬───────────────────┘
                            │  push
                            ▼
                     deploy service
                            │
                            ▼
                   AgentWorkflow (DB)
                            │  dispatch metadata
                            ▼
                   Python agent (one process)
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
           Agent A       Agent B        Agent C
        (intake)       (support)      (marketing)
              │             ▲              ▲
              │  setActiveAgent / transfer_to_*
              └─────────────┴──────────────┘
```

- The **same room and audio session** persists across agent transitions —
  the user does not reconnect.
- Transitions can be triggered by the LLM (`transfer_to_<name>` tool calls
  injected from the workflow's transition graph) or by the frontend
  (`transferAgent('<name>')` from the Zustand store).
- Each agent's per-agent fields (`prompts`, `knowledgeBases`, `mcpServers`,
  `systemToolOverrides`) override the workflow defaults when that agent is
  active.

---

## Steps

### 1. Add the agent to `platform.yaml`

Open `platform.yaml` at the repo root. Inside `workflow.agents:`, append an entry.
Each agent block uses the same fields as a single-agent `agent:` block
(`llm`, `voice`, `stt`, `behavior`, `avatar`) plus per-agent assignment
fields (`prompts`, `knowledgeBases`, `mcpServers`, `systemToolOverrides`).

```yaml
workflow:
  name: triage-flow
  entry: intake
  agents:
    # ... existing agents ...

    - name: billing
      llm:
        provider: groq
        model: meta-llama/llama-4-scout-17b
        temperature: 0.4
      voice:
        provider: elevenlabs
        # voiceId: "..."
      stt:
        provider: deepgram
        language: en
      prompts:
        speakLlm: public/prompts/billing.md
        showLlm: public/prompts/billing-scene.md
      knowledgeBases: [billing-faq]
      mcpServers: [crm]
      # systemToolOverrides:
      #   scene_viewer:
      #     description: "Render invoice tables and refund forms."
```

**Rules**:
- `name` must be unique within the workflow (used as the transition target
  and the argument to `transferAgent('<name>')`).
- `prompts.speakLlm` is **required** — the agent's system prompt. Same
  convention as single-agent sites: a plain markdown file under
  `public/prompts/`.
- `knowledgeBases` and `mcpServers` reference top-level definitions by slug
  (KB) or name (MCP). Top-level definitions live in `platform.yaml` exactly as
  they do for single-agent sites.

### 2. Create the prompt file

**Location**: `public/prompts/{agentName}.md` (matching `prompts.speakLlm`).

```markdown
You are the billing specialist for Acme Co. You answer questions about
invoices, refunds, and payment methods. Speak in a calm, professional tone.

If the user asks about something outside billing (product features, support,
account setup), use the transfer tool to hand off back to intake.
```

Optionally also create `{agentName}-scene.md` for the Show LLM (one-brain
scene rendering instructions).

### 3. Add transitions

Inside `workflow.transitions:`, declare at least one edge that involves
the new agent. Each transition needs a `description` — that string is
what the LLM sees when deciding whether to call the auto-injected
`transfer_to_<to>` tool.

```yaml
workflow:
  transitions:
    # ... existing transitions ...

    - from: intake
      to: billing
      description: "user has a billing, invoice, or refund question"

    - from: billing
      to: intake
      description: "user's question is outside billing scope"
      preserveHistory: true     # default
      llmCanTrigger: true       # default
```

**Rules**:
- `from` and `to` must reference `agents[].name` values.
- `description` must be non-empty. Be specific about the trigger condition
  — vague descriptions ("user wants help") cause the LLM to over-trigger.
- `preserveHistory: false` discards the prior chat history when entering
  the next agent. Useful for resetting context between unrelated specialists.
- `llmCanTrigger: false` makes the transition frontend-only — no
  `transfer_to_<to>` tool is exposed to the LLM. The edge is still walkable
  via `transferAgent('<to>')`.
- No duplicate `(from, to)` pairs per workflow.

### 4. Optionally trigger from the frontend

For UI buttons or screen changes that should force a transition (regardless
of what the LLM is currently doing), call `transferAgent` from a component:

```tsx
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';

export function GoToBillingButton() {
  const { transferAgent, currentAgentName } = useVoiceSessionStore();

  return (
    <button
      onClick={async () => {
        const result = await transferAgent('billing');
        if (!result.ok) console.warn('handoff failed:', result.error);
      }}
      disabled={currentAgentName === 'billing'}
    >
      Switch to billing
    </button>
  );
}
```

`currentAgentName` is reactive Zustand state — read it to disable the button
when already on the target agent, or to show the active agent in your UI:

```tsx
const currentAgentName = useVoiceSessionStore((s) => s.currentAgentName);
// null on single-agent sites; 'intake' / 'support' / 'billing' inside a workflow.
```

The runtime validates the call:
- Returns `{ ok: false, error: 'session is not running a workflow' }` if
  the site is single-agent.
- Returns `{ ok: false, error: '...' }` if no transition exists from the
  current agent to `name`.

### 5. Push to deploy

```bash
git add platform.yaml public/prompts/billing.md
git commit -m "Add billing agent to triage-flow workflow"
git push
```

The deploy service picks up the changes:
1. Reads `platform.yaml`, validates against the workflow schema.
2. Diffs against the existing `AgentWorkflow` in the dashboard:
   - New agents → created (and linked via `WorkflowAgent`).
   - Removed agents → unlinked (the underlying `Agent` record is preserved
     — same "unassign, never delete" pattern as KBs).
   - Changed agent settings → updated in place.
   - New / removed / changed transitions → CRUD.
3. Node positions in the visual editor are preserved for existing agents;
   new agents are auto-placed on next open.

The next voice session uses the new graph immediately — no restart needed.

---

## Validation rules (catch before pushing)

- `workflow.entry` must reference an `agents[].name`.
- Every `transitions[].from` and `to` must reference an `agents[].name`.
- Every `transitions[].description` must be non-empty.
- Agent names within a workflow are unique.
- No duplicate `(from, to)` pairs.
- `advancedRouting: true` requires `fastModel` (e.g. `groq:openai/gpt-oss-20b`).
- `sceneGeneration.brainMode` must be `ONE_BRAIN` when `workflow:` is present.
- The file must contain `workflow:` **or** `agent:`, never both, never neither.

Invalid `platform.yaml` never breaks deploys — errors are logged on the platform
side and the previous DB state is preserved. But it does mean your changes
silently don't apply, so check the dashboard's deploy log after pushing.

---

## Common Patterns

### Specialist hub-and-spoke
One general-purpose `intake` agent at the entry, several specialists
(`billing`, `support`, `sales`) reachable from intake. Specialists transfer
back to intake when the user's topic shifts.

### Linear flow
`greeting → qualification → demo → close`. Each agent transitions only
forward; `llmCanTrigger: false` on backward edges (only the frontend or a
"start over" button can rewind).

### Frontend-driven screens
A SaaS dashboard with `dashboard`, `settings`, `support` agents — the
voice agent switches with the page. Transitions have `llmCanTrigger: false`;
only `transferAgent` calls from `useEffect` on each route trigger handoffs.

### Branching with `preserveHistory: false`
Reset context when crossing topic boundaries (e.g. an onboarding flow that
hands off to a billing specialist later in the same call — the billing
agent shouldn't see the onboarding chitchat).

---

## Checklist

- [ ] Added `workflow.agents[]` entry with `name`, `llm`, `prompts.speakLlm`
- [ ] Created prompt MD file at the path in `prompts.speakLlm`
- [ ] Added at least one entry in `workflow.transitions[]` referencing the new agent
- [ ] Each new transition has a non-empty `description`
- [ ] (If using frontend handoffs) Component imports `useVoiceSessionStore`
      and calls `transferAgent('<name>')`
- [ ] `sceneGeneration.brainMode: ONE_BRAIN` (workflow sites must be one-brain)
- [ ] No `agent:` block at the top level (mutually exclusive with `workflow:`)
- [ ] Pushed and verified the workflow appears in the dashboard's editor

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `platform.yaml` push didn't update the workflow | Validation failed silently | Check the dashboard's deploy log — invalid YAML is logged but not surfaced as a deploy failure |
| `transferAgent` returns `'session is not running a workflow'` | Single-agent site | The site has `agent:`, not `workflow:` in `platform.yaml` |
| `transferAgent` returns `'no transition from X to Y'` | Edge not declared | Add a `transitions[]` entry with `from: X, to: Y, description: "..."` |
| LLM never hands off, even with the right description | Description too vague | Rewrite to include concrete keywords the user is likely to say |
| LLM hands off too aggressively | Description too broad | Tighten the description; consider `llmCanTrigger: false` if only the frontend should transition |
| `currentAgentName` is `null` mid-session on a workflow site | Agent process didn't set `lk.agent.name` attribute | Check the agent logs — likely a workflow runtime initialization error |
| Brain-mode warning blocks save | Site was previously two-brain | Switch to one-brain mode in the dashboard before assigning a workflow |
