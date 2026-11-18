# Voice AI Platform — Client Website Agent Guide

> **For coding agents** (Claude Code, Cursor, Copilot, etc.) working on client websites built from this template.

---

## Architecture Overview

This is a **client website** deployed on the Voice AI Platform. It has a persistent voice overlay powered by LiveKit that lets a voice AI agent control the UI — showing components, navigating pages, and collecting form data.

**Key concepts:**
- The **voice agent** (Python, runs server-side) controls the UI by calling `show_component(templateType, data)`
- The **DynamicComponentRenderer** resolves `templateType` to a React component via the **component registry**
- Components live in `src/components/tele-components/` and are auto-registered
- The agent sends JSON data; the component renders it visually

---

## Directory Structure

```
src/
├── components/
│   ├── tele-components/              ← Voice-renderable components (THE MAIN LIBRARY)
│   │   ├── component-registry.ts     ← Registry mapping type → component
│   │   ├── types.ts                  ← TeleComponentProps interface
│   │   ├── index.ts                  ← Public exports
│   │   ├── BarChart.tsx              ← Example: data visualization
│   │   ├── Form.tsx                  ← Example: interactive form
│   │   ├── ProductCard.tsx           ← Example: content display
│   │   └── ...                       ← More built-in components
│   ├── voice/                        ← Voice infrastructure (DO NOT MODIFY)
│   │   ├── DynamicComponentRenderer.tsx  ← Resolves type → component
│   │   ├── AgentComponentSlot.tsx    ← Renders agent-pushed components
│   │   ├── VoiceOverlay.tsx          ← Persistent voice panel
│   │   ├── VoiceConnectButton.tsx    ← Connect button
│   │   └── VoiceSessionProvider.tsx  ← LiveKit session provider
│   ├── ui/                           ← shadcn/ui primitives
│   ├── Header.tsx                    ← Site header
│   └── Footer.tsx                    ← Site footer
├── app/                              ← Next.js pages
├── lib/
│   ├── stores/voice-session-store.ts ← Zustand store (DO NOT MODIFY)
│   └── utils.ts                      ← Utility functions
└── types/index.ts                    ← Shared TypeScript types
```

---

## Agent Communication (tellAgent / informAgent / askAgent / transferAgent)

Methods for client-side code to communicate with the voice agent. These are the primary way your website code talks to the agent.

| Method | User chat bubble | Agent responds | LLM | Use for |
|--------|-----------------|---------------|-----|---------|
| `tellAgent` | Yes — visible | Yes | Yes | User-initiated actions (button clicks, form submissions) |
| `informAgent` | No — silent | No | No | Background context updates (page nav, cart changes, timers) |
| `askAgent` | No — silent | Yes | Yes | Triggering agent response without user attribution |
| `agentSay` | No — silent | Yes (exact text) | No | Direct TTS — agent speaks exact phrase, fastest option |
| `transferAgent` | No | (next agent's on_enter) | No | Workflow sites — switch the active agent in a multi-agent workflow |

### How to call them

All three are on the Zustand store:

```tsx
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';

const { tellAgent, informAgent, askAgent, agentSay } = useVoiceSessionStore();

// User clicked a button → show in chat + agent responds
await tellAgent('I want to book an appointment');

// Page navigated → silently update agent context, no response
await informAgent('User navigated to the pricing page.');

// Idle timer fired → agent responds but no user bubble in chat
await askAgent('The user has been idle for 30 seconds. Offer assistance.');

// Pre-written notification → direct TTS, no LLM, fastest
await agentSay('Your order has been confirmed. Thank you!');
```

Snake_case aliases also work: `tell_agent`, `inform_agent`, `ask_agent`, `agent_say`, `transfer_agent`.

### Decision guide

```
Does a user bubble need to appear in the chat bar?
  YES → tellAgent("What the user said or did")
  NO  →
    Does the agent need to respond (speak/reply)?
      YES →
        Should the agent interpret via LLM?
          YES → askAgent("Instruction for the agent")
          NO  → agentSay("Exact phrase to speak")
      NO  → informAgent("Background context")
```

### Common mistakes

- Do NOT use `tellAgent` for background events (page loads, timers). Use `informAgent` or `askAgent`.
- Do NOT use `askAgent` when you only need to update context silently. Use `informAgent`.
- The `message` string is required and must be non-empty.

### `transferAgent(name, options?)` — switch to a different agent in a workflow

Use this when the site is running a multi-agent workflow and the frontend
needs to switch the active agent (e.g. on screen change, button click).
Single-agent sites never call this — it returns `{ ok: false, error: '...' }`
when no workflow is loaded.

```tsx
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';

const { transferAgent, currentAgentName } = useVoiceSessionStore();

await transferAgent('support');                              // basic
await transferAgent('support', { preserveHistory: false }); // explicit override
```

The agent runtime validates that:
- The session is running a workflow (otherwise `{ ok: false, error: '...' }`).
- A transition from the current agent to `name` exists in the workflow graph.

`currentAgentName` is reactive Zustand state — read it in components to show
the active agent or branch UI conditionally:

```tsx
const currentAgentName = useVoiceSessionStore((s) => s.currentAgentName);
```

When the LLM hands off itself (via a `transfer_to_*` tool call), `currentAgentName`
also updates without you calling `transferAgent`. The frontend doesn't need to
know how the handoff happened; it just reacts to the name change.

The snake_case alias `transfer_agent` also works for AI-coding-assistant compatibility.

> **Full reference:** See `.claude/skills/agent-communication/SKILL.md` for direct RPC examples, payload schemas, backend details, and all naming aliases.

---

## Configuration File: `platform.yaml`

The `platform.yaml` file at the repo root controls all voice agent and website settings. It enables **configuration-as-code** — manage settings in your editor and version-control them via Git.

### How it works (important!)

1. **Editing `platform.yaml` locally has NO immediate effect.** Changes only apply after you `git push` and the deployment completes.
2. On push, the deploy service reads `platform.yaml`, validates it, and applies settings to the platform database.
3. The dashboard UI will reflect the new settings after deploy finishes.
4. Dashboard settings can also be pushed back to `platform.yaml` from the admin panel.

**The workflow is always: edit → push → wait for deploy → settings take effect.**

### All configurable properties

#### Site settings

```yaml
site:
  name: "My Store"                    # Display name
  active: true                        # Enable/disable the site
  greeting: "Hi! How can I help?"     # Agent's opening message
```

#### Widget appearance

```yaml
widget:
  primaryColor: "#6B21A8"             # Accent color (hex)
  position: bottom-right              # bottom-right | bottom-left | top-right | top-left
```

#### Default states

```yaml
defaults:
  avatarEnabled: false                # Start with avatar on/off
  avatarVisible: true                 # Avatar panel visible on connect
  micMuted: false                     # Start with mic muted
  volumeMuted: false                  # Start with volume muted
```

#### Agent LLM

```yaml
agent:
  llm:
    provider: openai                  # openai | groq | cerebras | together | fireworks | deepseek | anthropic
    model: gpt-4.1-mini              # See public/platform-options.yaml for full model list
    temperature: 0.8                  # 0.0 - 2.0
```

Common models: `gpt-4.1-nano` (fastest), `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`, `gpt-realtime-1.5` (voice-to-voice)

#### Agent voice / TTS

```yaml
agent:
  voice:
    provider: elevenlabs              # elevenlabs | cartesia | openai | google
    model: eleven_flash_v2_5          # Provider-specific model ID
    voiceId: "voice-id-here"          # Specific voice ID from provider
    # style: "warm and calm"          # google only: how every line is delivered
```

#### Agent STT (speech-to-text)

```yaml
agent:
  stt:
    provider: deepgram                # deepgram | openai | assemblyai
    language: en                      # Language code (en, es, fr, de, etc.)
```

#### Agent behavior

```yaml
agent:
  behavior:
    allowInterruptions: true          # Can user interrupt the agent mid-speech
```

#### Agent avatar

```yaml
agent:
  avatar:
    enabled: false                    # Enable avatar feature
    provider: liveavatar              # liveavatar (only active provider currently)
```

#### Scene generation (UI Engine)

```yaml
sceneGeneration:
  brainMode: TWO_BRAIN               # ONE_BRAIN (agent generates scenes) | TWO_BRAIN (separate UI engine)
  uiEngineModel: gpt-4.1-nano        # Model for UI scene generation
  knowledgeMode: SEARCH              # SEARCH (vector search per query) | CONTEXT (load all into context)
```

#### Tool announcements

```yaml
toolAnnouncement:
  mode: SPEECH                        # SILENT (no output) | SPEECH (agent announces tool calls)
```

#### Knowledge bases

```yaml
knowledgeBases:
  - name: "Product FAQ"
    slug: "product-faq"
    documentsPath: knowledge/product-faq/   # Path to docs in repo (auto-ingested on first deploy)
```

Place `.pdf`, `.md`, `.txt`, `.docx`, `.csv` files in the `documentsPath` directory. On first push, the KB is auto-created and documents are ingested. On subsequent pushes with changed files, updates are staged for manual approval in the dashboard.

#### MCP servers

```yaml
mcpServers:
  - name: "my-api"
    description: "My custom API"
    transportType: HTTP               # HTTP | SSE | STDIO
    url: "https://api.example.com/mcp"
    headers:
      Authorization: "Bearer sk-..."
    allowedTools:                      # Optional — null means all tools
      - search
      - lookup
```

MCP servers listed in `platform.yaml` are auto-created if they don't exist in the client's account.

#### Connected app integrations (Slack, Google Workspace, Microsoft 365)

OAuth-based integrations are connected once via the **Apps** page in the dashboard — that's where the OAuth popup runs. **`platform.yaml` cannot create integrations**, only reference already-connected ones. Use it to:

1. Pick which integrations this agent has access to.
2. Restrict which of each integration's tools the agent is allowed to call.

```yaml
integrations:
  - provider: SLACK
    allowedTools:
      - slack_post_message
      - slack_send_dm
  - provider: GOOGLE_WORKSPACE
    # No allowedTools = all Google tools allowed
  - provider: MICROSOFT_365
    allowedTools: [outlook_create_event, outlook_send_message, outlook_list_events]
```

- Reference by **`provider`** (the enum value: `SLACK`, `GOOGLE_WORKSPACE`, `MICROSOFT_365`). Case-sensitive. Stable across renames.
- **`allowedTools`** semantics match MCP servers:
  - omitted → all tools allowed
  - `[]` → none allowed
  - `[name, ...]` → explicit allowlist
- See `public/platform-options.yaml` for every supported provider and its full tool list with descriptions.

##### Tell the agent how to call them

The integration tools are registered as direct function tools (e.g. `slack_post_message(channel, text)`), **not** as site functions. In your prompt, explicitly tell the LLM to call them by name:

```markdown
The following tools are available. Call each by its tool name as a function call —
do NOT wrap them inside `call_site_function` (that is for site-side functions only).

- `slack_post_message` — Post a message to a Slack channel.
- `google_calendar_create_event` — Create a calendar event.
```

#### Prompt files

```yaml
prompts:
  speakLlm: public/prompts/speak-llm-system-prompt.md
```

Prompt text goes in `.md` files (e.g., `public/prompts/`), not inline in `platform.yaml`. The `prompts` section points to those files.

### Key rules

- **All fields are optional.** Only include what you want to change. Omitted fields keep their dashboard values.
- **Invalid `platform.yaml` never breaks deploys.** Errors are logged and skipped.
- **Repos are private.** Sensitive fields like MCP headers and env vars are safe in `platform.yaml`.
- **Removing a KB from `platform.yaml`** unassigns it from the agent but does NOT delete the KB.
- **Full options reference:** See `public/platform-options.yaml` for all valid provider IDs, model IDs, enum values, voice IDs, and language codes.

---

## Creating a New Tele-Component

### Step 1: Create the component file

Create `src/components/tele-components/MyWidget.tsx`:

```tsx
'use client';

import { TeleComponentProps } from './types';

/**
 * MyWidget — Brief description of what this component renders.
 *
 * Props (via data):
 *   title: string           — Main heading
 *   items: Array<{ ... }>   — The data items
 *   showXYZ?: boolean       — Optional config (default: true)
 */
export default function MyWidget({ data, accentColor = '#2563eb', onAction }: TeleComponentProps) {
  const title = data.title as string | undefined;
  const items: Array<{ label: string; value: number }> = Array.isArray(data.items) ? data.items : [];

  if (items.length === 0) return null;

  return (
    <div className="w-full space-y-3">
      {title && <h3 className="text-base font-semibold">{title}</h3>}
      {/* Render your component */}
    </div>
  );
}
```

### Step 2: Register it in the registry

Add one line to `src/components/tele-components/component-registry.ts`:

```ts
reg('MyWidget', () => import('./MyWidget'));
```

That's it. The DynamicComponentRenderer will now resolve `template.type === 'MyWidget'` to your component.

### Step 3: Register the template in the database

The component discovery service automatically scans for new components on `git push` and creates ComponentTemplate records. If manually registering, create a template with:
- `type`: `'MyWidget'` (must match the filename exactly)
- `schema`: JSON Schema for the props
- `defaultData`: Default values for all props
- `description`: What the component does (used by the voice agent to decide when to show it)

---

## Component Conventions (MUST FOLLOW)

### 1. File & naming
- **Filename**: PascalCase, matching `template.type` exactly (e.g. `BarChart.tsx` → type `"BarChart"`)
- **Location**: `src/components/tele-components/`
- **Export**: `export default function ComponentName`

### 2. Props interface
All components receive `TeleComponentProps`:
```ts
interface TeleComponentProps {
  data: Record<string, any>;     // Merged template defaults + agent data
  accentColor?: string;           // Theme color (default: #2563eb)
  onAction?: (phrase: string) => void;  // Send action back to voice agent
}
```

Extract typed fields from `data` at the top of the component:
```ts
const title = data.title as string | undefined;
const items: MyItem[] = Array.isArray(data.items) ? data.items : [];
```

### 3. Defensive rendering
- Always handle missing/empty data gracefully
- Return `null` if essential data is missing
- Default arrays to `[]`, booleans to sensible defaults
- Never crash on unexpected data shapes

### 4. Styling
- Use Tailwind CSS classes only (no CSS modules, no styled-components)
- Use `accentColor` prop for theme-aware colors via `style={{ color: accentColor }}`
- Keep components responsive (mobile-first with `md:` / `lg:` breakpoints)
- Use `text-muted-foreground` for secondary text

### 5. Interactivity
- Use `onAction?.(phrase)` to send user interactions back to the voice agent
- For forms, use the `useVoiceSessionStore` `submitForm` function
- The agent receives the action phrase and can respond conversationally

### 6. Documentation
- Add a JSDoc comment at the top of the component listing all props with types and descriptions
- Use the `Props (via data):` format (see existing components for examples)

### 7. No external dependencies
- Built-in components must use ONLY: React, Tailwind, and the voice session store
- No additional npm packages (keeps bundle size minimal)
- SVG-based charts preferred over chart libraries

---

## Built-in Component Types

| Category | Components |
|----------|-----------|
| **Data Viz** | BarChart, LineChart, PieChart, StatsRow, ProgressTracker |
| **Content** | ProductCard, InfoCards, ImageGallery, QuoteCallout, FAQ, MediaContent |
| **Interactive** | Form, ComparisonTable, Quiz, Checklist |
| **Layout** | HeroSplit, Timeline, CarouselCards, TrioColumns, ProcessFlow |
| **Specialized** | ProfileRoster, StatusList, NumberedList, MeetingScheduler |

---

## How the Voice Agent Uses Components

The Python voice agent has tools to control the UI:

```python
# Agent decides to show a chart
show_component("BarChart", {
    "title": "Monthly Revenue",
    "bars": [
        {"label": "Jan", "value": 12000},
        {"label": "Feb", "value": 15000},
    ],
    "unit": "$"
})
```

The flow:
1. Agent calls `show_component` → RPC to frontend
2. Frontend receives `{templateType: "BarChart", data: {...}}`
3. `DynamicComponentRenderer` looks up "BarChart" in registry
4. Lazy-loads and renders `BarChart.tsx` with the data
5. Component appears in the `AgentComponentSlot` on the page

---

## Debugging: Observability Mode

To debug voice agent interactions in the browser, open the console and run:

```js
window.observability = true
```

This enables color-coded, collapsible logging of all communication between the site and the voice agent:

| Color | Category | What's logged |
|-------|----------|---------------|
| Blue | Site → Agent | `tellAgent`, `informAgent`, `askAgent`, `agentSay` calls + responses |
| Purple | Agent → Site | `setScene`, `navigate`, `clearScene`, `callSiteFunction` RPCs |
| Amber | Data channel | UI engine scenes, tool activity, tele:feedback |
| Green | State | Agent state changes (listening → thinking → speaking) |
| Pink | Speech | Transcriptions (user/agent, interim/final) |
| Gray | Lifecycle | Session connect/disconnect, participant join/leave |
| Orange | Site functions | Site function invocations with args + results |

To disable: `window.observability = false`

Zero overhead when disabled — all log functions check the flag before doing anything.

---

## DO NOT MODIFY

These files are platform infrastructure. Changes will break the voice session:

- `src/components/voice/*` — Voice overlay & session management
- `src/lib/stores/voice-session-store.ts` — Zustand store
- `src/components/voice/DynamicComponentRenderer.tsx` — Only modify if adding new resolution logic
- `src/types/index.ts` — Core type definitions

---

## Quick Reference: Adding a Component

```bash
# 1. Create the component
touch src/components/tele-components/MyWidget.tsx

# 2. Write it following TeleComponentProps interface
# 3. Add to registry:
#    reg('MyWidget', () => import('./MyWidget'));

# 4. Push to Git → discovery service auto-registers the template
git add -A && git commit -m "Add MyWidget tele-component" && git push
```
