---
name: agent-communication
description: "Use when the client asks to communicate with the voice agent — tellAgent, informAgent, askAgent, agentSay, transferAgent RPC methods, or workflow agent transitions. Triggers on: 'call tell_agent', 'use informAgent', 'send message to agent', 'notify the agent', 'ask the agent', 'update agent context', 'make the agent say', 'agent say', 'transfer agent', 'switch agent', 'change active agent', 'workflow handoff'."
---

# Agent Communication Patterns — Mobeus Platform

RPC methods for client-side code to communicate with the voice agent.
When a client says "call tell_agent", "use inform_agent", "call ask_agent",
"transfer to the support agent", etc., use the patterns below to implement it correctly.

---

## Overview

| Method | Chat bar | Response | LLM | Purpose |
|--------|----------|----------|-----|---------|
| `tellAgent` | User bubble visible | Yes | Yes | User action appears in chat + agent responds |
| `informAgent` | Nothing | No | No | Silently update agent context, no response |
| `askAgent` | Nothing | Yes | Yes | Trigger agent response, no user bubble shown |
| `agentSay` | Nothing | Yes (exact text) | No | Direct TTS — agent speaks exact phrase, no LLM |
| `transferAgent` | Nothing | Next agent's `on_enter` runs | No | Workflow sites only — switch the active agent |

---

## Frontend: How to Call (TypeScript / React)

All three are available on the Zustand store `useVoiceSessionStore`:

```tsx
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';

// Inside a component:
const { tellAgent, informAgent, askAgent } = useVoiceSessionStore();

// or snake_case aliases work too:
const { tell_agent, inform_agent, ask_agent } = useVoiceSessionStore();
```

### tellAgent — user message appears in chat + triggers response

```tsx
// Shows a user chat bubble with the message, then agent responds out loud.
// Use for button clicks, form submissions, or anything the user "said".
await tellAgent('I want to schedule an appointment');
```

### informAgent — silent context injection, no response

```tsx
// Adds a system message to the agent's context without triggering a response.
// Nothing appears in the chat bar. Use for page navigations, state changes,
// or background context the agent should know about.
await informAgent('User navigated to the pricing page.');
await informAgent('Cart total is now $142.00 with 3 items.');
```

### askAgent — silent trigger, agent responds (via LLM)

```tsx
// Like informAgent: no user bubble in chat bar.
// Like tellAgent: agent DOES generate a spoken/text response.
// The message goes through the LLM, so the agent interprets and responds naturally.
await askAgent('The user has been idle for 30 seconds. Offer assistance.');
await askAgent('A form validation error occurred. Let the user know gently.');
```

### agentSay — direct TTS, no LLM

```tsx
// Agent speaks the EXACT phrase provided — no LLM interpretation.
// Goes straight to TTS, bypassing the language model entirely.
// Fastest option. Use for pre-written messages, notifications, or UI-driven speech.
await agentSay('Your order has been confirmed. Thank you!');
await agentSay('Welcome back! Click any product to learn more.');
```

### transferAgent — switch the active agent in a workflow

```tsx
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';

const { transferAgent, currentAgentName } = useVoiceSessionStore();

// Frontend-driven handoff (button click, screen change, etc.)
const result = await transferAgent('support');
if (!result.ok) console.warn('handoff failed:', result.error);

// Optional override: discard prior chat history when entering the next agent
await transferAgent('billing', { preserveHistory: false });
```

`currentAgentName` is reactive Zustand state — read it in components to show
the active agent or branch UI conditionally:

```tsx
const currentAgentName = useVoiceSessionStore((s) => s.currentAgentName);
// null on single-agent sites; string ('intake', 'support', ...) inside a workflow.
```

The runtime validates that:
- The session is running a workflow (otherwise `{ ok: false, error: 'session is not running a workflow' }`).
- A transition from the current agent to `name` exists in the workflow graph.

LLM-driven handoffs (`transfer_to_*` tool calls) update `currentAgentName`
automatically — the frontend doesn't need to call `transferAgent` itself.

---

## Direct RPC (without the store)

If you are not using the Zustand store, call LiveKit RPC directly:

```ts
import { Room } from 'livekit-client';

async function callAgent(room: Room, method: string, message: string) {
  const agent = [...room.remoteParticipants.values()]
    .find(p => p.identity.startsWith('agent'));
  if (!agent) return;

  const response = await room.localParticipant.performRpc({
    destinationIdentity: agent.identity,
    method,                              // see accepted names below
    payload: JSON.stringify({ message }),
  });
  return JSON.parse(response);
}

// All accepted method name formats:
callAgent(room, 'tellAgent',   message);  // or 'tell_agent'  or 'tell-agent'
callAgent(room, 'informAgent', message);  // or 'inform_agent' or 'inform-agent'
callAgent(room, 'askAgent',    message);  // or 'ask_agent'   or 'ask-agent'
callAgent(room, 'agentSay',    message);  // or 'agent_say'   or 'agent-say'

// transferAgent uses a different RPC method name and payload shape:
async function transferAgent(room: Room, name: string, preserveHistory?: boolean) {
  const agent = [...room.remoteParticipants.values()]
    .find(p => p.identity.startsWith('agent'));
  if (!agent) return;
  const response = await room.localParticipant.performRpc({
    destinationIdentity: agent.identity,
    method: 'setActiveAgent',
    payload: JSON.stringify({ name, preserveHistory }),
  });
  return JSON.parse(response);  // { ok: true, currentAgent } | { ok: false, error }
}
```

---

## Payload Schema

`tellAgent`, `informAgent`, `askAgent`, and `agentSay` accept the same JSON payload:

```json
{ "message": "string — the text to send to the agent" }
```

…and return:

```json
{ "success": true }
// or on error:
{ "success": false, "error": "reason" }
```

`transferAgent` uses a different method name (`setActiveAgent`) and shape:

```json
// Request payload:
{ "name": "support", "preserveHistory": true }
// Response:
{ "ok": true, "currentAgent": "support" }
// or on error:
{ "ok": false, "error": "no transition from intake to support" }
```

---

## Backend: How It Works (Python — agent/main.py)

```
tellAgent   → session.generate_reply(instructions="The user clicked a UI element and said: {message}")
               (no user message added to chat_ctx — the UI adds the chat bubble client-side)

informAgent → current_agent.chat_ctx.add_message(role="system", content="[Context Update] {message}")
               current_agent.update_chat_ctx(chat_ctx)
               (no generate_reply call — context is updated silently)

askAgent    → session.generate_reply(instructions=message)
               (instructions are ephemeral — not stored in chat history — so no user bubble appears)

agentSay    → session.say(phrase, add_to_chat_ctx=False)
               (direct TTS — no LLM, no chat context — agent speaks the exact text)

setActiveAgent → workflow_runtime.set_active_agent({ name, preserveHistory })
               (workflow only — validates transition, swaps agents via session.update_agent,
                emits the new lk.agent.name attribute which the store mirrors as currentAgentName)
```

---

## Naming Convention

Each RPC method is registered under **three aliases**. Any of these will work:

| Canonical | snake_case | kebab-case |
|-----------|-----------|------------|
| `tellAgent` | `tell_agent` | `tell-agent` |
| `informAgent` | `inform_agent` | `inform-agent` |
| `askAgent` | `ask_agent` | `ask-agent` |
| `agentSay` | `agent_say` | `agent-say` |
| `transferAgent` | `transfer_agent` | (RPC method is `setActiveAgent`, not aliased) |

---

## Decision Guide

```
Are you switching to a different agent in a multi-agent workflow?
  YES → transferAgent("agent-name")
  NO  →
    Does a user bubble need to appear in the chat bar?
      YES → tellAgent("What the user said or did")
      NO  →
        Does the agent need to respond (speak/reply)?
          YES →
            Should the agent interpret the message via LLM?
              YES → askAgent("What to trigger the agent with")
              NO  → agentSay("Exact phrase for the agent to speak")
          NO  → informAgent("Background context for the agent")
```

---

## Common Mistakes

- **Do NOT call `tellAgent` for background events** (page loads, timers, navigation).
  Use `informAgent` or `askAgent` for those. `tellAgent` is for user-initiated actions.

- **Do NOT call `askAgent` when you only want to update context** without the agent
  speaking. Use `informAgent` — it's silent on both sides.

- **The `message` field is required and must be non-empty.** All three handlers return
  `{ success: false, error: "Empty message" }` if the string is blank after trimming.

- **Snake_case aliases (`tell_agent`, `inform_agent`, `ask_agent`, `transfer_agent`) are real methods**
  on the Zustand store — they forward directly to the camelCase versions. You can
  destructure them from the store just like `tellAgent`.

- **Do NOT call `transferAgent` on single-agent sites.** It returns
  `{ ok: false, error: 'session is not running a workflow' }`. Check
  `currentAgentName` first (null = single-agent) or only render handoff UI on
  workflow sites.

---

## Debugging

Enable observability mode in the browser console to see all agent communication:

```js
window.observability = true
```

All `tellAgent`, `informAgent`, `askAgent`, and `agentSay` calls will be logged with color-coded, collapsible console groups showing the message, response, and metadata. `transferAgent` calls go through the standard RPC path and surface in the LiveKit network panel. Disable with `window.observability = false`. Zero overhead when off.
