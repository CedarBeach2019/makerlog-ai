# OpenMAIC Deep Study — TTRPG & StudyLog Adaptation

> Repo: [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) v0.1.0
> Date: 2026-03-26
> Purpose: Inform DMlog.ai (TTRPG platform) and studylog.ai (study platform) design

---

## 1. Executive Summary

OpenMAIC is a production-ready open-source multi-agent interactive classroom built on Next.js 16 + React 19 + LangGraph. It transforms topics/documents into full interactive lessons with slides, quizzes, whiteboard drawing, TTS narration, and real-time multi-agent discussions.

**Why it matters for DMlog.ai:**
- The entire multi-agent orchestration pattern (director → agents → actions) maps 1:1 to TTRPG sessions: Game Master (director) → NPCs (agents) → scene actions
- The Action system (speech, whiteboard, spotlight, laser) directly maps to TTRPG scene narration, map reveals, character highlights
- The "Roundtable" component is essentially a player/DM interface with avatars, speech bubbles, and reactive UI
- The playback engine's state machine (idle → playing → paused → live) is exactly a TTRPG session flow

**Why it matters for studylog.ai:**
- Scene types (slide, quiz, interactive, PBL) are study session primitives
- The generation pipeline (outline → scenes → content) produces structured study materials
- Quiz grading with AI feedback is production-ready
- The interactive whiteboard is ideal for collaborative study rooms

**Key stats:**
- ~150+ TypeScript source files (excluding node_modules and vendor packages)
- Dependencies: LangGraph, Vercel AI SDK, motion (Framer), Zustand, Tailwind CSS 4, pptxgenjs
- Fully stateless backend — all state in client requests
- SSE streaming for real-time multi-agent generation

---

## 2. Architecture

### 2.1 High-Level Stack

```
┌─────────────────────────────────────────────────┐
│  Frontend (Next.js App Router + React 19)       │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Roundtable│ │  Canvas   │ │  Chat / Sidebar  │ │
│  │ Component │ │  Area     │ │  Components      │ │
│  └─────┬─────┘ └─────┬─────┘ └────────┬─────────┘ │
│        │             │                │           │
│  ┌─────┴─────────────┴────────────────┴─────────┐ │
│  │        Zustand Stores (stage, settings,      │ │
│  │        canvas, chat, agent-registry)         │ │
│  └────────────────────┬─────────────────────────┘ │
└───────────────────────┼───────────────────────────┘
                        │ SSE (fetch + ReadableStream)
┌───────────────────────┼───────────────────────────┐
│  Backend (Next.js API Routes)                    │
│  ┌────────────────────┴─────────────────────────┐ │
│  │  POST /api/chat → stateless-generate()       │ │
│  │  POST /api/generate/* → outline/scene/action  │ │
│  │  POST /api/tts → Azure/OpenAI TTS            │ │
│  │  POST /api/quiz-grade → AI grading           │ │
│  └────────────────────┬─────────────────────────┘ │
│                       │                          │
│  ┌────────────────────┴─────────────────────────┐ │
│  │  LangGraph StateGraph (director → agents)    │ │
│  │  Director Graph:                             │ │
│  │    START → director ──(end)──→ END           │ │
│  │              │                               │ │
│  │              └─(next)→ agent_gen → director   │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 2.2 Data Flow (Live Chat)

1. User sends message → `POST /api/chat` with `StatelessChatRequest`
2. Request includes: full message history, store state (stage/scenes), agent config, API credentials
3. `statelessGenerate()` creates a LangGraph `StateGraph`
4. Director node decides which agent speaks (single-agent: code logic; multi-agent: LLM decision)
5. Agent generates structured JSON array: `[{type:"action",name:"...",params:{...}}, {type:"text",content:"..."}, ...]`
6. Events streamed as SSE: `agent_start`, `text_delta`, `action`, `cue_user`, `done`
7. Client processes events: speech bubbles, TTS playback, whiteboard drawing, discussion triggers

### 2.3 Key Design Decisions

- **Stateless backend**: No session storage. Client sends full state on every request. Simplifies scaling (Workers-compatible pattern).
- **Structured JSON output**: Agents output `[action, text, action, text, ...]` interleaved arrays, not freeform text. Parsed with `partial-json` + `jsonrepair` for robust streaming.
- **Fire-and-forget vs sync actions**: Spotlight/laser are immediate visual effects; speech/whiteboard/discussion are blocking (wait for completion).
- **Director as orchestrator**: The director is a meta-agent that never speaks to users — it only decides *which agent* speaks and *when to stop*.

---

## 3. Agent System

### 3.1 Agent Configuration

```typescript
interface AgentConfig {
  id: string;
  name: string;
  role: 'teacher' | 'assistant' | 'student';
  persona: string;        // Freeform personality description
  avatar: string;          // URL or path
  color: string;           // Brand color hex
  allowedActions: string[];// Which actions this agent can use
  priority: number;        // Higher = speaks first in discussions
  isGenerated?: boolean;   // Auto-generated vs default agents
  boundStageId?: string;   // Scope to specific classroom
}
```

Agents are stored in a Zustand `agent-registry` store. Default agents ship with the app; users can create custom ones. Generated agents can be scoped to a specific classroom.

### 3.2 Director Graph (LangGraph)

The orchestration uses LangGraph's `StateGraph` with a unified topology for single and multi-agent:

```
START → director ──(end)──→ END
            │
            └─(next)→ agent_generate ──→ director (loop)
```

**Director logic:**
- **Single agent**: Pure code — dispatch agent on turn 0, cue user on subsequent turns
- **Multi agent**: LLM-based decision with fast-paths:
  - Turn 0: Always dispatch the `triggerAgentId` (or highest priority teacher)
  - Turn limit: Force end if `turnCount >= maxTurns`
  - Otherwise: LLM decides which agent speaks next based on conversation summary

**Director prompt construction** (`director-prompt.ts`):
- Builds agent list with IDs, names, roles, priorities
- Includes conversation summary, whiteboard ledger state, user profile
- Discussion mode vs Q&A mode有不同的规则
- Includes "when to end" criteria (all agents responded, topic exhausted, user satisfied)

**Director decision output** (structured JSON):
```json
{
  "next_agent_id": "teacher-1",
  "reason": "User asked about X, teacher should explain first",
  "should_end": false
}
```

### 3.3 Agent Generation (Structured Output)

When an agent is dispatched, it receives a structured prompt built by `prompt-builder.ts`:
- System message with agent persona + role + available actions
- Scene context (current slide content, whiteboard state)
- Conversation history (summarized if too long)
- Allowed actions with JSON schemas from `tool-schemas.ts`

The agent outputs a JSON array, e.g.:
```json
[
  {"type":"action","name":"speech","params":{"text":"Let me explain..."}},
  {"type":"action","name":"spotlight","params":{"elementId":"title-1"}},
  {"type":"action","name":"wb_open","params":{}},
  {"type":"action","name":"wb_draw_chart","params":{"chartType":"bar","x":100,"y":50,...}},
  {"type":"text","content":"As you can see from this chart..."}
]
```

### 3.4 Action System

The unified Action type union from `types/action.ts`:

| Category | Actions | Blocking? |
|----------|---------|-----------|
| Visual | `spotlight`, `laser` | No (fire-and-forget) |
| Speech | `speech` | Yes (wait for TTS) |
| Whiteboard | `wb_open`, `wb_draw_text`, `wb_draw_shape`, `wb_draw_chart`, `wb_draw_latex`, `wb_draw_table`, `wb_draw_line`, `wb_clear`, `wb_delete`, `wb_close` | Yes |
| Media | `play_video` | Yes |
| Social | `discussion` | Yes (triggers roundtable) |

### 3.5 TTRPG Mapping

| OpenMAIC Concept | TTRPG Equivalent | Notes |
|-----------------|-----------------|-------|
| Director agent | Game Master (AI DM) | Decides who acts, when scenes end |
| Teacher agent | NPC / Narrator | Provides information, sets context |
| Student agent | NPC companion / party member | Has personality, can initiate discussions |
| User (learner) | Player character | Sends messages, triggers actions |
| Scene → slide | Scene → location/map | Visual backdrop for narration |
| Scene → quiz | Skill check / puzzle | Interactive challenge |
| Speech action | Narration | DM or NPC describes what's happening |
| Spotlight action | Focus on NPC/object | "The old man leans forward..." |
| Whiteboard draw | Map annotation | "The DM draws the dungeon layout..." |
| Discussion action | NPC interaction / party dialogue | Multi-character conversation |
| Playback engine | Session state machine | idle → exploring → combat → roleplay |

**Specific adaptation for DMlog.ai:**

```
Director (AI DM)
├── Narrator agent (describes scenes, sets atmosphere)
├── NPC-1 agent (guard at the gate — gruff, suspicious)
├── NPC-2 agent (merchant — friendly, greedy)
├── NPC-3 agent (mysterious stranger — cryptic)
└── Player (user)
    ├── Sends actions: "I approach the guard"
    ├── Rolls dice (dice action — new)
    └── Makes choices (branching action — new)
```

New action types needed for TTRPG:
- `dice_roll` — Trigger dice roll with type (d20, d6, etc.), modifier, reason
- `scene_change` — Transition to new scene/location with description
- `npc_appear` / `npc_leave` — Add/remove NPCs from scene
- `ambient_play` — Play background audio/music
- `inventory_update` — Add/remove items from player inventory
- `stat_change` — Modify HP, MP, stats
- `branch_choice` — Present player with branching choices
- `time_pass` — Advance game time, trigger time-based events
- `combat_start` / `combat_end` — Enter/exit combat mode

---

## 4. Interactive Presentation System

### 4.1 Stage & Scene Model

```typescript
interface Stage {
  id: string;
  name: string;
  description?: string;
  whiteboard?: Whiteboard[];
  agentIds?: string[];
}

interface Scene {
  id: string;
  stageId: string;
  type: 'slide' | 'quiz' | 'interactive' | 'pbl';
  title: string;
  order: number;
  content: SceneContent;  // Type-specific
  actions?: Action[];      // Playback actions
  whiteboards?: Slide[];
  multiAgent?: {
    enabled: boolean;
    agentIds: string[];
    directorPrompt?: string;
  };
}
```

### 4.2 Slide System

Built on PPTist (open-source PPT editor). Slides are JSON canvas data with elements:
- Text, images, shapes, charts, tables, LaTeX formulas
- Each slide element has a unique `elementId` for targeting by actions
- Slides support themes, transitions, and turning modes

The Canvas Area (`canvas-area.tsx`) renders slides with:
- Spotlight overlay (dims all except target element)
- Laser pointer animation (red dot following elements)
- Whiteboard overlay (transparent drawing layer)
- Presentation mode (fullscreen, speech bubbles overlay)

### 4.3 Quiz System

```typescript
interface QuizQuestion {
  id: string;
  type: 'single' | 'multiple' | 'short_answer';
  question: string;
  options?: QuizOption[];
  answer?: string[];
  analysis?: string;
  commentPrompt?: string;
  hasAnswer?: boolean;
  points?: number;
}
```

- Multiple question types (single/multiple choice, short answer)
- AI grading via `/api/quiz-grade` endpoint
- Immediate feedback with analysis
- Points system for gamification

### 4.4 Whiteboard System

The whiteboard is a transparent overlay on top of slides with:
- Draw text, shapes, charts, LaTeX, tables, lines/arrows
- Each element has a custom `elementId` for later deletion
- Coordinate system: 0-1000 x 0-562 (16:9 aspect ratio)
- Open/close animation
- Whiteboard ledger tracks all actions for director awareness

### 4.5 Playback Engine

A state machine class (`PlaybackEngine`) that:
- Consumes `Scene.actions[]` directly — no compile step
- States: `idle → playing → paused → live`
- Supports pre-generated TTS audio or browser-native Web Speech API
- Auto-detects CJK language for TTS voice selection
- Proactive discussion triggers: when a `discussion` action fires, shows a "ProactiveCard" asking user if they want to join
- Progress tracking with `PlaybackSnapshot` for resume-on-refresh

### 4.6 TTRPG Scene Adaptation

Replace "slides" with "scene illustrations" — same canvas system, different content:
- Location art (tavern, dungeon, forest) instead of educational diagrams
- Character portraits as spotlight targets instead of slide elements
- Map layers instead of charts
- Ambient text overlays for scene descriptions

**Scene types for TTRPG:**
| OpenMAIC | TTRPG | Implementation |
|----------|-------|----------------|
| `slide` | `scene` — location with narration | Same canvas, different generator prompt |
| `quiz` | `skill_check` — dice-based challenge | Modified quiz with dice mechanics |
| `interactive` | `exploration` — point-and-click area | iframe or custom canvas interaction |
| `pbl` | `quest` — multi-step objective | Task tracking + NPC interactions |

### 4.7 StudyLog Scene Adaptation

Study sessions map directly:
| OpenMAIC | StudyLog | Notes |
|----------|----------|-------|
| `slide` | `lecture` — study material | Same system, study-focused prompts |
| `quiz` | `practice` — quiz/practice | Same system, spaced repetition metadata |
| `interactive` | `simulation` — interactive demo | Chemistry sim, code playground, etc. |
| `pbl` | `project` — project workspace | Research project with milestones |

---

## 5. Roundtable Component — The Core UI

### 5.1 Overview

`components/roundtable/index.tsx` (~700 lines) is the central interaction hub. It's essentially:

**Three-column layout:**
```
┌──────────┬────────────────────────┬──────────────┐
│ Teacher  │   Interaction Stage    │  Participants │
│ Avatar   │   (speech bubbles,     │  (student    │
│          │    input, voice)       │   avatars,   │
│          │                        │   user btns) │
└──────────┴────────────────────────┴──────────────┘
```

### 5.2 Key Features

- **Presentation mode**: Fullscreen overlay with floating speech bubbles, dock (bottom), toolbar
- **Voice input**: Web Speech API recording with animated waveform visualization
- **Text input**: Textarea with send button, cooldown to prevent double-sends
- **Thinking indicator**: Animated dots when director/agent is processing
- **"Your turn" cue**: Pulsing button when user is expected to respond
- **ProactiveCard**: Popover when an NPC wants to initiate discussion (skip/listen)
- **TTS controls**: Mute, volume, playback speed, auto-play
- **Keyboard shortcuts**: T (text), V (voice), Space (pause/resume), Escape (dismiss)
- **End flash notification**: Brief toast when discussion/QA ends
- **Agent hover cards**: Show agent name, role, persona on hover

### 5.3 Props Architecture

The component is highly prop-driven (28+ props), making it composable:
- `mode`: `'playback' | 'autonomous'`
- `playbackView`: Centralized derived state (phase, sourceText, bubbleRole, buttonState, isInLiveFlow)
- `speakingAgentId`, `currentSpeech`, `thinkingState`: Live state from SSE
- Callbacks: `onMessageSend`, `onDiscussionStart`, `onDiscussionSkip`, `onStopDiscussion`, etc.

### 5.4 TTRPG Adaptation of Roundtable

The Roundtable is almost perfectly suited for TTRPG with minor modifications:

```
┌──────────┬────────────────────────┬──────────────┐
│ Scene    │   Narrative /          │  Party       │
│ Art      │   Dialogue Area        │  Members     │
│ (tavern) │   (DM narration,       │  (player +   │
│          │    NPC speech,         │   NPC        │
│          │    player actions)     │   avatars)   │
└──────────┴────────────────────────┴──────────────┘
```

**Modifications needed:**
1. Replace "Teacher avatar" with "Scene art panel" (larger, shows location illustration)
2. Add dice roll UI (d20 roller overlay instead of quiz)
3. Add character sheet sidebar (HP, stats, inventory)
4. Add initiative tracker for combat
5. Add "Game log" tab (scrollable history of events)
6. Modify ProactiveCard for NPC-initiated interactions
7. Add ambient audio controls (background music, SFX)

### 5.5 StudyLog Adaptation of Roundtable

For study sessions, the Roundtable becomes a "Study Room":
- Teacher avatar → AI tutor avatar
- Student agents → Study buddies (optional, for collaborative study)
- Discussion → Study discussion (ask questions, explore topics)
- Quiz actions → Practice questions
- Whiteboard → Collaborative scratchpad

---

## 6. Backend Architecture

### 6.1 API Routes

| Route | Purpose |
|-------|---------|
| `POST /api/chat` | Stateless multi-agent chat (SSE stream) |
| `POST /api/generate/scene-outlines-stream` | Generate lesson outline (streaming) |
| `POST /api/generate/scene-content` | Generate scene content (slides, quiz, etc.) |
| `POST /api/generate/scene-actions` | Generate playback actions for a scene |
| `POST /api/generate/agent-profiles` | Generate custom agent personas |
| `POST /api/generate/tts` | Text-to-speech (Azure/OpenAI) |
| `POST /api/generate/image` | Generate images (for slides) |
| `POST /api/generate/video` | Generate videos |
| `POST /api/transcription` | Speech-to-text (for voice input) |
| `POST /api/quiz-grade` | AI grading for quiz answers |
| `POST /api/classroom` | Classroom CRUD (CRUD operations) |
| `GET /api/azure-voices` | List available Azure TTS voices |
| `POST /api/web-search` | Web search for enrichment |
| `POST /api/pbl/chat` | PBL project chat |

### 6.2 Stateless Chat API (`/api/chat`)

The most important endpoint for our adaptation. Fully stateless:

```typescript
interface StatelessChatRequest {
  messages: UIMessage[];           // Full conversation history
  storeState: {
    stage: Stage | null;
    scenes: Scene[];
    currentSceneId: string | null;
    mode: 'autonomous' | 'playback';
    whiteboardOpen: boolean;
  };
  config: {
    agentIds: string[];
    sessionType?: 'qa' | 'discussion';
    discussionTopic?: string;
    discussionPrompt?: string;
    triggerAgentId?: string;
    agentConfigs?: AgentConfig[];  // For generated agents
  };
  directorState?: DirectorState;   // Accumulated state from previous turns
  userProfile?: { nickname?: string; bio?: string };
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerType?: string;
}
```

**SSE event types:**
- `agent_start` — Agent begins speaking (id, name, avatar, color)
- `agent_end` — Agent finishes
- `text_delta` — Streaming text chunk
- `action` — Structured action (name, params, agentId)
- `thinking` — Director/agent processing indicator
- `cue_user` — Prompt user to respond
- `done` — Generation complete (with directorState for next turn)
- `error` — Error message

### 6.3 Workers Compatibility

The stateless design is excellent for Cloudflare Workers adaptation:
- **No session storage** — all state in request/response
- **SSE via ReadableStream** — works on Workers with `TransformStream`
- **External API calls only** — LLM providers, TTS, etc.

**Challenges for Workers:**
1. **LangGraph dependency** — `@langchain/langgraph` may not run on Workers. Solution: reimplement the director graph as a simple loop with LLM calls
2. **`partial-json` + `jsonrepair`** — Need to verify Workers compatibility. Both are lightweight JSON utilities, should work
3. **TTS streaming** — Azure TTS needs WebSocket or HTTP streaming. Works via `fetch` on Workers
4. **File system** — No `fs` on Workers. OpenMAIC uses it for classroom media storage — replace with R2/KV

**Simplified Workers architecture:**
```
Worker receives StatelessChatRequest
  → Director decision (single LLM call or code logic)
  → Agent generation (single LLM call with structured output)
  → Stream SSE events back
```

No LangGraph needed — the director graph is just:
1. Build director prompt
2. Call LLM
3. Parse decision JSON
4. If not ended: build agent prompt, call LLM, parse actions/text
5. Repeat from 1

---

## 7. Code Patterns Worth Porting

### 7.1 Structured JSON Array Output Pattern

This is the most valuable pattern. Instead of tool calling, agents output interleaved JSON arrays:

```typescript
// Agent output format
[
  {"type":"action","name":"speech","params":{"text":"Let me explain..."}},
  {"type":"text","content":"As you can see from this chart..."},
  {"type":"action","name":"wb_draw_chart","params":{...}}
]
```

**Why this works:**
- No tool call overhead (no parallel tool execution, no retry logic)
- Actions and narration can interleave naturally
- Easy to parse incrementally with `partial-json`
- Single generation pass (no loop)

**Port to log-origin:**
```typescript
// Workers-compatible structured generation
async function* generateResponse(request: ChatRequest): AsyncGenerator<Event> {
  const response = await ai.generate({
    model: request.model,
    prompt: buildPrompt(request),
    responseFormat: { type: 'json_object' },
  });
  
  const parser = createParserState();
  for await (const chunk of response.textStream) {
    const result = parseChunk(parser, chunk);
    yield* result.textChunks.map(c => ({ type: 'text_delta', content: c }));
    yield* result.actions.map(a => ({ type: 'action', ...a }));
  }
}
```

### 7.2 Incremental JSON Streaming Parser

The `ParserState` + `parseChunk` pattern in `stateless-generate.ts`:
- Accumulates raw text
- Finds opening `[`
- Uses `partial-json` to incrementally parse
- Emits complete items as they appear
- Streams partial text content for the last item
- Handles `jsonrepair` for malformed LLM output

**Port:** This is framework-agnostic and can be directly ported. Dependencies are just `partial-json` and `jsonrepair`.

### 7.3 Director-Orchestrator Pattern

The separation of "director" (meta-agent that decides) and "agents" (content generators) is clean:
- Director never speaks to users
- Director maintains conversation summary, agent response history, whiteboard ledger
- Each agent gets a scoped prompt with their persona + scene context

**Port:** Implement as a simple stateful loop on Workers. No LangGraph needed.

### 7.4 Playback Engine State Machine

The `PlaybackEngine` class with explicit states and transitions:
- Clean state machine: `idle | playing | paused | live`
- Action execution with blocking semantics (sync actions wait for completion)
- Audio playback integration with Web Speech API fallback
- Progress persistence for resume-on-refresh

**Port:** Can be implemented as a Zustand store with effects, or as a vanilla JS class.

### 7.5 Proactive Discussion Trigger

The `TriggerEvent` + `ProactiveCard` pattern:
- During playback, when a `discussion` action fires, a card appears
- User can "Listen" (join discussion) or "Skip" (continue playback)
- This is the key interactive element that makes the classroom feel alive

**TTRPG adaptation:** NPCs can proactively approach the player:
- Guard stops you: "Halt! What's your business?"
- Merchant waves you over: "Come see my wares!"
- Companion suggests: "Maybe we should check that door..."

### 7.6 Agent Registry + Config System

```typescript
// Zustand store for agent configurations
const useAgentRegistry = create((set, get) => ({
  agents: new Map<string, AgentConfig>(),
  getAgent: (id: string) => get().agents.get(id),
  setAgent: (config: AgentConfig) => { ... },
  removeAgent: (id: string) => { ... },
}));
```

Clean separation of agent identity from orchestration logic. Port directly.

### 7.7 SSE Heartbeat Pattern

```typescript
const HEARTBEAT_INTERVAL_MS = 15_000;
const startHeartbeat = () => {
  heartbeatTimer = setInterval(() => {
    writer.write(encoder.encode(`:heartbeat\n\n`));
  }, HEARTBEAT_INTERVAL_MS);
};
```

SSE comments (`:heartbeat\n\n`) keep the connection alive through proxies. Essential for long-running generation on Workers.

---

## 8. Frontend Component Architecture

### 8.1 Component Tree

```
app/page.tsx
├── components/stage/
│   ├── stage-toolbar.tsx      # Top bar: play/pause, scene nav, settings
│   └── scene-panel.tsx        # Scene type switcher
├── components/canvas/
│   ├── canvas-area.tsx        # Main slide canvas with overlays
│   └── canvas-toolbar.tsx     # Drawing/annotation tools
├── components/roundtable/
│   └── index.tsx              # Central interaction hub (28+ props)
├── components/agent/
│   ├── agent-avatar.tsx       # Agent avatar with status indicator
│   ├── agent-bar.tsx          # Horizontal agent list
│   └── agent-config-panel.tsx # Agent configuration form
├── components/chat/
│   ├── chat-area.tsx          # Message list with agent bubbles
│   └── chat-session.tsx       # Session management
├── components/audio/
│   ├── speech-button.tsx      # TTS toggle button
│   └── tts-config-popover.tsx # Voice/speed settings
└── lib/stores/
    ├── stage.ts               # Stage/scene state (Zustand)
    ├── canvas.ts              # Canvas/whiteboard state
    ├── settings.ts            # User preferences
    └── agent-registry.ts      # Agent configurations 
### 8.2 Zustand Store Pattern

```typescript
// Example: stage store
const useStageStore = create<StageState>((set) => ({
  stages: [],
  currentStageId: null,
  scenes: [],
  currentSceneId: null,
  mode: 'autonomous' as StageMode,
  
  setStages: (stages) => set({ stages }),
  setCurrentScene: (id) => set({ currentSceneId: id }),
  addScene: (scene) => set((s) => ({ scenes: [...s.scenes, scene] })),
  updateScene: (id, patch) => set((s) => ({
    scenes: s.scenes.map(sc => sc.id === id ? { ...sc, ...patch } : sc)
  })),
}));
```

Clean, flat stores with direct setters. No middleware complexity.

### 8.3 AI Elements Library

OpenMAIC includes a full `ai-elements/` component library (~30 components):
- Canvas, panel, toolbar, message, reasoning, code-block, image, node, edge
- Plan, task, queue, sources, suggestion, shimmer, loader
- Connection, controls, conversation, checkpoint

These are generic AI UI components. For TTRPG, we'd need:
- Character card (replaces message bubble with character portrait + name)
- Dice roller (new component)
- Inventory panel (new component)
- Map canvas (replace slide canvas)
- Combat tracker (new component)
- Initiative tracker (new component)

---

## 9. Generation Pipeline

### 9.1 Classroom Generation Flow

```
User input (topic + optional documents)
    ↓
1. Generate Agent Profiles (/api/generate/agent-profiles)
   → Teacher + 2-3 student NPCs based on topic
    ↓
2. Generate Scene Outlines (/api/generate/scene-outlines-stream)
   → Streaming: [{title, type, description, agentIds}, ...]
    ↓
3. Generate Scene Content (per scene)
   → slide: PPTist canvas JSON
   → quiz: QuizQuestion[]
   → interactive: HTML/URL
   → pbl: Project config
    ↓
4. Generate Scene Actions (per scene)
   → [{type, name, params}, ...] — playback actions
```

### 9.2 Action Generation Prompt

The system prompt for action generation includes:
- Agent persona and role
- Allowed actions with full JSON schemas
- Current scene content (slide elements with IDs)
- Conversation context (summarized)
- Whiteboard state (ledger of drawn elements)

Key constraint: "Text is natural teacher speech, NOT meta-commentary"

### 9.3 TTRPG Content Generation

Adapt the pipeline for TTRPG:

```
User input (campaign premise, world, characters)
    ↓
1. Generate NPC Profiles
   → Tavern keeper, quest giver, antagonist, companion
    ↓
2. Generate Scene Outlines
   → [{title: "The Tavern", type: "scene", description: "...", npcs: ["keeper-1"]}, ...]
    ↓
3. Generate Scene Content
   → scene: Location art + description + interactive elements
   → encounter: Combat encounter with stat blocks
   → dialogue: Dialogue tree with branching
    ↓
4. Generate Scene Actions
   → Narration, NPC lines, ambient descriptions, trigger events
```

### 9.4 StudyLog Content Generation

```
User input (topic, difficulty, learning objectives)
    ↓
1. Generate Tutor Profiles
   → Main tutor + optional study buddy agents
    ↓
2. Generate Scene Outlines
   → [{title: "Introduction", type: "lecture"}, {title: "Practice", type: "quiz"}, ...]
    ↓
3. Generate Scene Content
   → lecture: Educational slides
   → practice: Adaptive quiz questions
   → simulation: Interactive demo
    ↓
4. Generate Scene Actions
   → Tutor narration, explanation actions, practice prompts
```

---

## 10. TTRPG Adaptation Plan — DMlog.ai

### 10.1 Architecture Changes from OpenMAIC

| OpenMAIC | DMlog.ai | Change |
|----------|----------|--------|
| Stage → Classroom | Stage → Campaign | Rename |
| Scene → Slide/Quiz | Scene → Location/Encounter | Different types |
| Teacher → Lecturer | Teacher → Game Master | Role |
| Student → Classmate | Student → NPC/Companion | Role |
| Playback → Lecture | Playback → Session | Mode |
| Quiz → Test | Quiz → Skill Check | Mechanics |
| Whiteboard → Drawing | Whiteboard → Map/Notes | Purpose |

### 10.2 DM Console (Game Master Interface)

The DM console is essentially OpenMAIC's autonomous mode with added controls:

```
┌─────────────────────────────────────────────────┐
│ DM Console — "The Forgotten Realm"              │
├─────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────────────────────┐ │
│ │ Scene       │ │ Narrative Stream             │ │
│ │ Art Panel   │ │ DM: "You enter the tavern"  │ │
│ │             │ │ NPC: "Welcome, stranger..."  │ │
│ │ [Location   │ │ Player: "I order a drink"    │ │
│ │  image]     │ │ DM: [dice roll] Success!     │ │
│ │             │ │ Player: "I ask about the..."  │ │
│ └─────────────┘ └─────────────────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ Controls: [Pause] [Speed] [Skip] [End Scene] │ │
│ └──────────────────────────────────────────────┘ │
│ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│ │ NPCs     │ │ Players  │ │ World State       │  │
│ │ (avatars)│ │ (status) │ │ (inventory, etc)  │  │
│ └──────────┘ └──────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Implementation:** Fork `roundtable/index.tsx`, replace teacher panel with scene art, add game-specific panels.

### 10.3 Player Interface

Players see a simplified version:

```
┌─────────────────────────────────────────────────┐
│ Scene Art (location illustration)                │
├─────────────────────────────────────────────────┤
│ Narrative:                                       │
│ "The guard eyes you suspiciously. 'State your   │
│  business, traveler,' he grunts."                │
│                                                  │
│ [NPC: Guard — portrait] [NPC: Merchant]          │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ > I show him my letter from the King         │ │
│ │ > I try to sneak past him                    │ │
│ │ > I bribe him with 5 gold                    │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ 🎲 [Roll d20 +5] [Inventory] [Character Sheet]   │
└─────────────────────────────────────────────────┘
```

**Implementation:** Simplified roundtable without teacher panel, with action buttons and dice roller.

### 10.4 Spectator Mode

Spectators watch the session in real-time without participating:

```
┌─────────────────────────────────────────────────┐
│ 👁 Spectating: "The Forgotten Realm"             │
├─────────────────────────────────────────────────┤
│ [Scene art] [Animated speech bubbles]            │
│                                                  │
│ DM: "You enter the tavern..."                   │
│ Guard NPC: "State your business!"               │
│ Player: "I show my letter"                      │
│ [🎲 Dice: 18 + 5 = 23 — Success!]              │
│ DM: "The guard steps aside..."                  │
│                                                  │
│ [TTS narration] [Ambient audio]                  │
│ [Auto-play with animations]                      │
└─────────────────────────────────────────────────┘
```

**Key features:**
- Auto-play with TTS narration
- Animated dice rolls
- Scene transitions with fade effects
- Ambient audio (background music, SFX)
- No input field (read-only)

### 10.5 New Action Types for TTRPG

```typescript
// Extend OpenMAIC's Action union
type TTRPGAction =
  // Inherited from OpenMAIC
  | SpeechAction
  | SpotlightAction
  | WbDrawTextAction
  | DiscussionAction
  // New TTRPG actions
  | DiceRollAction
  | SceneTransitionAction
  | NPCAction
  | AmbientAction
  | InventoryAction
  | StatChangeAction
  | BranchChoiceAction
  | CombatAction;

interface DiceRollAction extends ActionBase {
  type: 'dice_roll';
  dice: string;       // "2d6+3", "d20", "1d8"
  reason: string;     // "Persuasion check"
  result?: number;    // Filled by client after roll
  success?: boolean;  // Determined by DM
}

interface SceneTransitionAction extends ActionBase {
  type: 'scene_transition';
  sceneId: string;
  description: string;  // Narration for transition
  fadeIn?: boolean;
}

interface NPCAction extends ActionBase {
  type: 'npc_appear' | 'npc_leave' | 'npc_emote';
  agentId: string;
  emote?: string;      // "smiles", "draws sword"
}

interface AmbientAction extends ActionBase {
  type: 'ambient_play' | 'ambient_stop' | 'ambient_fade';
  audioId: string;
  volume?: number;     // 0-1
  loop?: boolean;
}

interface BranchChoiceAction extends ActionBase {
  type: 'branch_choice';
  options: Array<{
    id: string;
    text: string;
    requirement?: string;  // "Requires: Persuasion > 15"
  }>;
  timeout?: number;    // Seconds to choose (0 = no timeout)
}

interface CombatAction extends ActionBase {
  type: 'combat_start' | 'combat_end' | 'combat_turn';
  initiative?: number[];
  currentTurn?: string;  // agentId or player
}
```

---

## 11. StudyLog Adaptation Plan — studylog.ai

### 11.1 Study Session Flow

```
Student starts study session
    ↓
1. Select topic or upload materials
    ↓
2. AI generates study plan (outline)
    ↓
3. Interactive study scenes:
   ├─ Lecture (AI tutor explains with slides)
   ├─ Practice (quiz with adaptive difficulty)
   ├─ Exploration (interactive simulation)
   └─ Discussion (ask AI tutor questions)
    ↓
4. Summary + retention check
    ↓
5. Study room (persistent space for review)
```

### 11.2 Key Adaptations

**Lecture Scenes:**
- Same as OpenMAIC slides but with study-specific prompts
- Tutor agent explains concepts with whiteboard annotations
- Auto-generated study notes from lecture (OpenMAIC has `LectureNoteEntry` type)

**Practice Scenes:**
- Adaptive quiz: difficulty adjusts based on performance
- Spaced repetition metadata: track when to review
- Explanation mode: show step-by-step solution after wrong answer
- Study mode: hide answers, test later

**Study Room:**
- Persistent space (Stage in OpenMAIC terms)
- AI tutor available 24/7 for Q&A
- Collaborative whiteboard for note-taking
- Progress tracking (scenes completed, quiz scores)
- Export to Anki/Notion (future)

### 11.3 Minimal Changes Needed

StudyLog is closer to OpenMAIC than TTRPG. Main changes:
1. Add spaced repetition metadata to quiz questions
2. Add study plan generation (outline → scheduled sessions)
3. Add progress dashboard (retention rate, study streaks)
4. Add export to external tools (Anki, Notion, Obsidian)
5. Add study room persistence (save/load study sessions)

---

## 12. Integration Plan — What to Build First

### 12.1 Phase 1: Foundation (Weeks 1-3) — Easy

| Task | Effort | Depends on | Notes |
|------|--------|-----------|-------|
| Port `Action` types to log-origin | 0.5d | Nothing | Copy + extend for TTRPG |
| Port `ParserState` + incremental JSON parser | 1d | Nothing | Direct port, framework-agnostic |
| Port `DirectorState` + prompt builder | 1d | Action types | Simplify for Workers (no LangGraph) |
| Implement stateless chat API on Workers | 2d | Director + parser | SSE via TransformStream |
| Port `AgentConfig` + registry pattern | 0.5d | Nothing | Simple Zustand store |

### 12.2 Phase 2: TTRPG Core (Weeks 3-6) — Medium

| Task | Effort | Depends on | Notes |
|------|--------|-----------|-------|
| TTRPG action types (dice, combat, etc.) | 1d | Phase 1 types | Extend Action union |
| DM console layout (fork roundtable) | 3d | Phase 1 | Simplified roundtable |
| Player interface | 2d | DM console | Read-only spectator variant |
| Dice roller component | 1d | Nothing | Animated 3D dice or 2D |
| NPC management (appear/leave/emote) | 2d | Action types | Avatar + status |
| Scene transitions | 1d | Action types | Fade, slide animations |
| TTS narration for spectator mode | 2d | OpenAI TTS API | Stream + play |

### 12.3 Phase 3: StudyLog Core (Weeks 3-6) — Medium

| Task | Effort | Depends on | Notes |
|------|--------|-----------|-------|
| Study session generation pipeline | 3d | Phase 1 | Adapt outline → scene pipeline |
| AI tutor agent persona | 0.5d | Agent registry | Configure tutor agent |
| Quiz with adaptive difficulty | 2d | Phase 1 quiz | Score tracking + difficulty ramp |
| Study progress dashboard | 2d | Quiz data | Scenes completed, scores |
| Spaced repetition metadata | 1d | Quiz system | Review scheduling |

### 12.4 Phase 4: Advanced (Weeks 6-10) — Complex

| Task | Effort | Depends on | Notes |
|------|--------|-----------|-------|
| Combat system with initiative tracker | 5d | Phase 2 | Turn-based combat UI |
| Branching narrative engine | 3d | Phase 2 | Choice trees + state tracking |
| Ambient audio system | 3d | Phase 2 | BGM + SFX + crossfade |
| Multiplayer (real-time party) | 5d | Phase 2 | WebSocket + presence |
| Study room persistence | 3d | Phase 3 | Save/load + R2 storage |
| Export to Anki/Notion | 2d | Phase 3 | Card generation + API integration |
| Spectator replay (recorded sessions) | 3d | Phase 2 | Store actions + replay engine |

### 12.5 Effort Summary

| Phase | Duration | Complexity | Value |
|-------|----------|-----------|-------|
| 1. Foundation | 3 weeks | Low | Shared by both products |
| 2. TTRPG Core | 3 weeks | Medium | DMlog.ai MVP |
| 3. StudyLog Core | 3 weeks | Medium | studylog.ai MVP |
| 4. Advanced | 4 weeks | High | Differentiation |

**Total: ~13 weeks for both MVPs**

---

## 13. Key Files Reference

### 13.1 Must-Read Files (for implementation)

| File | Lines | Why |
|------|-------|-----|
| `lib/types/action.ts` | ~180 | Action type system — extend for TTRPG |
| `lib/types/chat.ts` | ~250 | Chat types + SSE events |
| `lib/types/stage.ts` | ~130 | Stage/scene model |
| `lib/orchestration/stateless-generate.ts` | ~435 | JSON array parser + streaming |
| `lib/orchestration/director-graph.ts` | ~550 | Director orchestration logic |
| `lib/orchestration/director-prompt.ts` | ~280 | Director prompt construction |
| `lib/orchestration/prompt-builder.ts` | ~200 | Agent prompt construction |
| `lib/orchestration/tool-schemas.ts` | ~150 | Action JSON schemas |
| `lib/playback/engine.ts` | ~740 | Playback state machine |
| `lib/playback/types.ts` | ~80 | Playback types |
| `components/roundtable/index.tsx` | ~700 | Central UI component |
| `app/api/chat/route.ts` | ~130 | Stateless chat endpoint |

### 13.2 Dependencies to Note

```json
{
  "@langchain/langgraph": "1.1+",      // Director graph — replace for Workers
  "ai": "4.x",                          // Vercel AI SDK — structured generation
  "partial-json": "^0.2.0",             // Incremental JSON parsing
  "jsonrepair": "^3.x",                 // Malformed JSON repair
  "zustand": "^5.x",                    // State management
  "motion": "^12.x",                    // Animations (Framer Motion)
  "@anthropic-ai/sdk": "latest",        // Anthropic provider
  "pptxgenjs": "local",                 // PPT export (vendored)
  "nanoid": "^5.x",                     // ID generation
  "openai": "^4.x"                      // OpenAI provider
}
```

**For Workers:** Drop LangGraph, use `ai` package (Workers-compatible), keep `partial-json` + `jsonrepair`, replace Zustand with vanilla signals or Svelte stores.

---

## 14. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| LangGraph not Workers-compatible | Can't port director graph directly | Reimplement as simple loop (only ~50 LOC of logic) |
| Structured JSON output unreliable | Agents produce invalid JSON | `jsonrepair` + fallback parsing + retry |
| TTS latency ruins playback experience | Speech feels laggy | Pre-generate TTS during content generation; buffer ahead |
| Multi-player race conditions | Concurrent dice rolls conflict | Server-authoritative state with CRDTs or OT |
| OpenMAIC AGPL-3.0 license | Copyleft requirement | Study patterns/ideas (not code) are free; only port non-copyleft snippets or reimplement |
| Canvas rendering performance on mobile | Slide/whiteboard slow on phones | Use CSS transforms (GPU-accelerated), lazy load scenes |

### 14.1 License Note

OpenMAIC is **AGPL-3.0**. This means:
- If we fork/copy code, the derivative must also be AGPL-3.0
- If we deploy server-side, we must offer source to users
- **We can freely study patterns and reimplement** without licensing obligations
- **We should NOT directly copy-paste** substantial code blocks into closed-source products
- For open-source products (DMlog.ai, studylog.ai), AGPL is compatible if we accept the copyleft

**Recommended approach:** Study the architecture, understand the patterns, reimplement in our own code with our own abstractions. Port small utility functions (parser, types) that are clearly generic.

---

## 15. Conclusion

OpenMAIC is the best reference implementation we could ask for. It validates the multi-agent orchestration pattern with real production code, provides battle-tested type definitions, and demonstrates the critical insight: **interleaved action/text JSON arrays are superior to tool calling for interactive storytelling**.

The three most valuable takeaways:
1. **Stateless backend + client-side state** — Perfect for Workers, simple to scale
2. **Director-orchestrator pattern** — Clean separation of "who decides" from "who acts"
3. **Action system as the interface layer** — Agents don't call tools; they emit structured actions that the client interprets

For DMlog.ai, the Roundtable component is 80% of the TTRPG player interface. For studylog.ai, the generation pipeline produces structured study materials automatically. The shared foundation (types, parser, director) serves both products.

The 13-week roadmap is aggressive but achievable with the patterns from this codebase.
