# Inter-Desk Communication Plan

> Status: **Planned** (not yet implemented)
> Source: Recovered from session `b4b75f1c` architect agent output

## Architecture Overview

The core insight: a running Claude session can only communicate with the outside world via HTTP calls to the Bridge API on localhost:3848. Inter-desk communication therefore requires new Bridge API endpoints that the bridge process uses to orchestrate Slack messages in #agent-comms and spawn/resume Claude sessions for the target desk.

## Message Flow Summary

```
Desk A (Claude session)
  --> POST /call-desk to Bridge API
    --> Bridge posts @desk-b message in #agent-comms thread
      --> Bridge spawns Desk B Claude session on that thread
        --> Desk B responds in #agent-comms thread
          --> Bridge collects response
            --> Returns response to Desk A's HTTP request (consultation)
            OR posts link in original thread (delegation)
```

## Three Communication Modes

1. **Delegation** - Fire-and-forget. Desk A hands off a sub-task to Desk B and continues working.
2. **Consultation** - Synchronous. Desk A asks Desk B a question and waits for the answer (120s timeout).
3. **Pipeline** - Sequential handoff where output flows A -> B -> C (chained consultations).

All inter-desk messages flow through a dedicated **#agent-comms** Slack channel for visibility and auditability.

---

## Phase 1: New Types and Configuration

**File: `src/types/desk.ts`**

```typescript
/** Inter-desk communication request */
export interface DeskCallRequest {
  /** The desk making the request */
  sourceSessionId: string;
  /** Target desk slug */
  targetDesk: string;
  /** The message/task to send */
  message: string;
  /** Communication pattern */
  mode: 'delegate' | 'consult' | 'pipeline';
  /** For pipeline: next desks in sequence */
  pipelineNext?: string[];
  /** Context from the original user thread */
  originContext?: {
    channelId: string;
    threadTs: string;
    summary: string;
  };
}

/** Inter-desk communication response */
export interface DeskCallResponse {
  ok: boolean;
  /** The #agent-comms thread where the exchange happens */
  commsThreadTs?: string;
  commsChannelId?: string;
  /** For consultation: the response text from the target desk */
  response?: string;
  /** Error message if failed */
  error?: string;
}

/** Delegation permissions for a desk */
export interface DeskDelegation {
  /** Which desks this desk can call (empty = all) */
  can_call?: string[];
  /** Whether this desk can receive delegated work (default: true) */
  accepts_delegations?: boolean;
}

// Add to DeskDefinition:
//   delegation?: DeskDelegation;
```

Opt-in: if `delegation` is absent, the desk can call any desk and accepts delegations. If `can_call` is specified, it restricts outbound calls.

---

## Phase 2: New Bridge API Endpoint

**File: `src/services/bridge-api.ts`**

Add `POST /call-desk` endpoint. Single entry point for all three patterns.

```typescript
if (method === 'POST' && url.pathname === '/call-desk') {
  return handleCallDesk(request);
}
```

The handler validates source session, target desk, delegation permissions, then dispatches based on mode (delegate/consult/pipeline).

---

## Phase 3: Inter-Desk Orchestrator Service

**New file: `src/services/desk-comms.ts`** (~200 lines)

Core module managing #agent-comms channel interactions and desk-to-desk session lifecycles.

### Key State

```typescript
// Pending consultation promise resolvers, keyed by comms thread_ts
const pendingConsultations: Map<string, {
  resolve: (text: string) => void;
  timeout: ReturnType<typeof setTimeout>;
  sourceSessionId: string;
}> = new Map();
```

### Delegation (fire-and-forget)

1. Post to #agent-comms: delegation header with origin link
2. Post @target-desk message as reply in that thread
3. Post link back in original user thread
4. Return immediately to Desk A

### Consultation (synchronous)

1. Post to #agent-comms with "Consultation" label
2. Create a Promise, store resolver in `pendingConsultations` map keyed by thread_ts
3. Post @target-desk message in thread
4. Await promise (120s timeout)
5. When Desk B responds, message handler calls `resolvePendingConsultation(threadTs, responseText)`
6. Return Desk B's response to Desk A's HTTP request

### Pipeline (sequential chain)

1. Run as consultation: Desk A -> Desk B (wait for response)
2. If `pipelineNext` has more desks, post Desk B's output to next desk
3. Chain until exhausted
4. Return final output to Desk A

One thread for the whole pipeline for auditability.

### Resolution Function

```typescript
export function resolvePendingConsultation(threadTs: string, responseText: string): boolean {
  const pending = pendingConsultations.get(threadTs);
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingConsultations.delete(threadTs);
  pending.resolve(responseText);
  return true;
}
```

---

## Phase 4: Message Handler Integration

**File: `src/handlers/message.ts`**

After finalization (around line 347, after `finalText` is determined):

```typescript
// Check if this is a consultation response in #agent-comms
if (channel === getAgentCommsChannel() && threadTs) {
  const resolved = resolvePendingConsultation(threadTs, finalText);
  if (resolved) {
    console.log(`[Handler] Resolved pending consultation in ${threadTs}`);
  }
}
```

Minimal integration. Existing handler already runs desk sessions -- we just capture output for consultation responses.

---

## Phase 5: System Prompt Injection

**File: `src/services/claude.ts`**

Append after `--- END BRIDGE API ---` in the system prompt. Lists available desks and documents the `/call-desk` curl commands for delegate, consult, and pipeline modes.

Only injected when desk context is present, so non-desk sessions are unaffected.

---

## Phase 6: Wiring

**File: `src/index.ts`**

- Import desk-comms initialization
- Resolve #agent-comms channel on startup

**Bot message filtering workaround:** Instead of posting to Slack and hoping the message handler picks it up, directly invoke `handleMessage()` with a synthetic message from the orchestrator. Slack messages in #agent-comms are for visibility/audit; execution is triggered programmatically.

---

## Phase 7: Environment and Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `AGENT_COMMS_CHANNEL` | Slack channel ID for #agent-comms | (required) |
| `DESK_CALL_TIMEOUT_MS` | Consultation timeout | `120000` |

---

## File Changes Summary

| File | Change | Scope |
|------|--------|-------|
| `src/types/desk.ts` | Add `DeskCallRequest`, `DeskCallResponse`, `DeskDelegation`; add `delegation?` to `DeskDefinition` | ~30 lines |
| `src/services/desk-comms.ts` | **New file.** Orchestrator for delegation, consultation, pipeline. Manages pending consultations map. | ~200 lines |
| `src/services/bridge-api.ts` | Add `POST /call-desk` route, import and delegate to desk-comms | ~20 lines |
| `src/services/claude.ts` | Inject available desks and `/call-desk` docs into system prompt | ~30 lines |
| `src/handlers/message.ts` | Hook consultation resolution into message finalization path | ~10 lines |
| `src/services/desk-loader.ts` | Handle new `delegation` field in YAML parsing | ~5 lines |
| `src/index.ts` | Import desk-comms, resolve #agent-comms channel on startup | ~5 lines |
| `docs/DESK_ROUTING.md` | Remove "No inter-desk communication" limitation, document feature | Documentation |

---

## Implementation Order (MVP)

> **Priority:** Consultation is the primary use case. Desks asking other desks questions and getting answers back is the core value.

1. Types -- Add interfaces to `src/types/desk.ts`
2. Desk-comms service -- Create `src/services/desk-comms.ts` with consultation as the primary pattern
3. Bridge API endpoint -- Add `/call-desk` to `src/services/bridge-api.ts`
4. Message handler hook -- Add consultation resolution to `src/handlers/message.ts`
5. System prompt -- Update `src/services/claude.ts` to show available desks and `/call-desk` docs
6. Test consultation end-to-end
7. Add delegation -- Extend desk-comms with fire-and-forget mode
8. Documentation -- Update `docs/DESK_ROUTING.md`

**Deferred to post-MVP:**
- Pipeline mode (chained consultations)
- Signed Bridge API tokens
- Per-desk rate limiting
- Synthetic message validation layer

---

## Council-Recommended Hardening (Must-Have)

These additions were identified by a council review and are required for shipping:

1. **Circuit breaker** -- Track desk health per slug, fail-fast after repeated timeouts instead of cascading failures
2. **Correlation IDs** -- Unique request ID per `/call-desk` invocation, logged through the entire flow
3. **Cleanup guarantees** -- Session termination clears pendingConsultations entries; stale entry cleanup timer (5 min)
4. **Structured logging** -- JSON logs for desk call start/end/timeout/error events
5. **User-visible handoff messages** -- Post "Consulting @backend..." in user's thread so they know what's happening
6. **Timeout feedback** -- Surface failures to user with actionable messages, not silent drops

---

## Edge Cases and Risks

- **Consultation timeout:** If Desk B crashes or is slow, Desk A's HTTP request hangs. 120s timeout + clear error responses handle this. Circuit breaker degrades gracefully after repeated failures.
- **Recursive calls:** Desk B could call Desk A, creating a loop. Add a `callDepth` counter; reject when depth > 3.
- **Concurrent consultations:** Safe -- each gets its own #agent-comms thread and promise, keyed by unique thread_ts.
- **Bot message filtering:** Posting to Slack as the bot then processing the message won't work (handler skips bot messages). Solution: call `handleMessage()` directly from orchestrator.
- **Session identity:** Desk B in #agent-comms gets its own session ID (comms channel + thread), independent from user thread sessions.
- **Original thread context:** `originContext` in `DeskCallRequest` lets the bridge post links in the original user thread. Source session ID maps to original channel/thread.
- **Memory leaks:** Cleanup timer evicts stale pendingConsultations entries after 5 minutes. Session termination also clears associated entries.
