# Human-in-the-Loop with AI SDK 6, assistant-ui, and Remote MCP

## Implementation Status

### TODO Tasks

- [ ] **hitl-1**: Create HITL tools module with proposeEmail, sendEmail, askForPlanApproval
- [ ] **hitl-2**: Create HITL system prompt builder (buildHitlSystemPrompt)
- [ ] **hitl-3**: Create loadHitlTools function to return HITL tools as Record<string, Tool>
- [ ] **hitl-4**: Integrate HITL tools into chat route (merge with existing tools)
- [ ] **hitl-5**: Add buildHitlSystemPrompt to system prompt merge in chat route
- [ ] **hitl-6**: Enable experimental_toolApproval and add onToolApprovalRequest handler
- [ ] **hitl-7**: Ensure HITL tools are hidden from tool selector UI (not in mentions)
- [ ] **hitl-8**: Test HITL tools work with all models and don't appear in tool menu

### Key Requirements

1. **Hidden from UI**: HITL tools should NOT appear in the tool selector dropdown
2. **System Prompt Triggered**: AI models use these tools based on system prompt instructions
3. **Always Available**: Merge with existing tools but bypass mention/selection logic
4. **Works with All Models**: Should work alongside MCP, Workflow, and App Default tools

## Overview

This guide implements human-in-the-loop (HITL) tool approval for AI agents using:

- **AI SDK 6** - Native tool approval (`needsApproval: true`)
- **assistant-ui** - UI components for email preview, plan approval, and input collection
- **Remote MCP Servers** - HTTP/SSE servers that work on Vercel (not local stdio)

**What We're Building:**

- ✅ Email preview with inline editing before sending
- ✅ Plan approval for multi-step workflows
- ✅ User input collection that blocks execution
- ✅ Works with any MCP server (Gmail, Slack, Calendar, etc.)
- ✅ Vercel/serverless compatible

**UI Components Source:** We adapt the beautiful UI components from the [mastra-hitl repository](https://github.com/assistant-ui/mastra-hitl), but use AI SDK 6 directly (no Mastra framework).

## 🔧 Backend Migration: What Needs to Change for AI SDK 6

Before implementing HITL features, you need to migrate your backend code from AI SDK 5 to AI SDK 6. Here are the **required changes**:

### 1. Update Dependencies

```bash
# Upgrade to AI SDK 6
pnpm add ai@^6.0.0 @ai-sdk/anthropic@latest @ai-sdk/openai@latest

# Optional: Install assistant-ui for HITL components
pnpm add @assistant-ui/react @assistant-ui/react-ai-sdk
```

### 2. Message Type Rename: `CoreMessage` → `ModelMessage`

**What Changed:** The `CoreMessage` type has been renamed to `ModelMessage` for better clarity.

```typescript
// ❌ AI SDK 5
import { type CoreMessage, convertToCoreMessages } from 'ai';

const messages: CoreMessage[] = convertToCoreMessages(uiMessages);
```

```typescript
// ✅ AI SDK 6
import { type ModelMessage, convertToModelMessages } from 'ai';

const messages: ModelMessage[] = await convertToModelMessages(uiMessages);
```

**Note:** `convertToModelMessages` is now **async** - don't forget to `await` it!

### 3. Tool Definition: `parameters` → `inputSchema` (AI SDK 5.0+)

**What Changed:** Tool definitions now use `inputSchema` instead of `parameters`.

```typescript
// ❌ AI SDK 4.x
import { tool } from 'ai';
import { z } from 'zod';

const weatherTool = tool({
  description: 'Get the weather for a city',
  parameters: z.object({
    city: z.string(),
  }),
  execute: async ({ city }) => {
    return `Weather in ${city}`;
  },
});
```

```typescript
// ✅ AI SDK 5.0+ (including v6)
import { tool } from 'ai';
import { z } from 'zod';

const weatherTool = tool({
  description: 'Get the weather for a city',
  inputSchema: z.object({
    city: z.string(),
  }),
  execute: async ({ city }) => {
    return `Weather in ${city}`;
  },
});
```

### 4. Structured Output: `generateObject` / `streamObject` → `generateText` / `streamText` + `Output.object()`

**What Changed:** Dedicated `generateObject` and `streamObject` functions are **deprecated**. Use `generateText` / `streamText` with `Output.object()` instead.

#### Replace `generateObject`

```typescript
// ❌ AI SDK 5
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const { object } = await generateObject({
  model: openai('gpt-4'),
  schema: z.object({
    recipe: z.object({
      name: z.string(),
      ingredients: z.array(z.object({ name: z.string(), amount: z.string() })),
      steps: z.array(z.string()),
    }),
  }),
  prompt: 'Generate a lasagna recipe.',
});
```

```typescript
// ✅ AI SDK 6
import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const { output } = await generateText({
  model: openai('gpt-4'),
  output: Output.object({
    schema: z.object({
      recipe: z.object({
        name: z.string(),
        ingredients: z.array(z.object({ name: z.string(), amount: z.string() })),
        steps: z.array(z.string()),
      }),
    }),
  }),
  prompt: 'Generate a lasagna recipe.',
});
```

**Key Changes:**

- `generateObject()` → `generateText()`
- `schema` → `output: Output.object({ schema })`
- Result is in `output` property instead of `object`

#### Replace `streamObject`

```typescript
// ❌ AI SDK 5
import { streamObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const { partialObjectStream } = streamObject({
  model: openai('gpt-4'),
  schema: z.object({
    recipe: z.object({
      name: z.string(),
      ingredients: z.array(z.object({ name: z.string(), amount: z.string() })),
      steps: z.array(z.string()),
    }),
  }),
  prompt: 'Generate a lasagna recipe.',
});

for await (const partialObject of partialObjectStream) {
  console.log(partialObject);
}
```

```typescript
// ✅ AI SDK 6
import { streamText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const { partialOutputStream } = streamText({
  model: openai('gpt-4'),
  output: Output.object({
    schema: z.object({
      recipe: z.object({
        name: z.string(),
        ingredients: z.array(z.object({ name: z.string(), amount: z.string() })),
        steps: z.array(z.string()),
      }),
    }),
  }),
  prompt: 'Generate a lasagna recipe.',
});

for await (const partialObject of partialOutputStream) {
  console.log(partialObject);
}
```

**Key Changes:**

- `streamObject()` → `streamText()`
- `schema` → `output: Output.object({ schema })`
- `partialObjectStream` → `partialOutputStream`

### 5. Strict JSON Schema: Provider Option → Per-Tool Configuration

**What Changed:** Strict mode is now configured per-tool instead of globally via provider options.

```typescript
// ❌ AI SDK 5
import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';

const result = streamText({
  model: openai('gpt-4'),
  tools: {
    calculator: tool({
      description: 'A simple calculator',
      inputSchema: z.object({
        expression: z.string(),
      }),
      execute: async ({ expression }) => {
        const result = eval(expression);
        return { result };
      },
    }),
  },
  providerOptions: {
    openai: {
      strictJsonSchema: true, // Applied to all tools
    },
  },
});
```

```typescript
// ✅ AI SDK 6
import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';

const result = streamText({
  model: openai('gpt-4'),
  tools: {
    calculator: tool({
      description: 'A simple calculator',
      inputSchema: z.object({
        expression: z.string(),
      }),
      execute: async ({ expression }) => {
        const result = eval(expression);
        return { result };
      },
      strict: true, // Control strict mode per tool
    }),
  },
});
```

**Key Changes:**

- Remove `providerOptions.openai.strictJsonSchema`
- Add `strict: true` to individual tool definitions

### 6. API Route Updates

Update your chat API routes to use the new async message conversion:

```typescript
// app/api/chat/route.ts

// ❌ AI SDK 5
export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    messages: convertToCoreMessages(messages), // Sync
    tools: { /* your tools */ },
  });

  return result.toDataStreamResponse();
}
```

```typescript
// ✅ AI SDK 6
export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    messages: await convertToModelMessages(messages), // Now async!
    tools: { /* your tools */ },
  });

  return result.toDataStreamResponse();
}
```

### 7. Automated Migration with Codemods

AI SDK 6 provides codemods to automatically update your codebase:

```bash
# Run all v6 codemods
npx @ai-sdk/codemod v6

# Run a specific codemod
npx @ai-sdk/codemod v6/rename-core-message-to-model-message src/
```

**Available codemods:**

- `rename-core-message-to-model-message` - Updates type imports
- `rename-convert-to-core-messages` - Updates message conversion functions
- `rename-text-embedding-to-embedding` - Updates embedding function names
- And more...

### Migration Checklist

Use this checklist to ensure your backend is AI SDK 6 compatible:

- [ ] Updated `ai` package to v6.0.0+
- [ ] Replaced `CoreMessage` with `ModelMessage`
- [ ] Changed `convertToCoreMessages` to `convertToModelMessages` (and added `await`)
- [ ] Updated tool definitions: `parameters` → `inputSchema`
- [ ] Migrated `generateObject` → `generateText` + `Output.object()`
- [ ] Migrated `streamObject` → `streamText` + `Output.object()`
- [ ] Moved `strictJsonSchema` from provider options to per-tool `strict` property
- [ ] Updated API routes to await `convertToModelMessages()`
- [ ] Ran codemods to catch any missed changes
- [ ] Tested all tool executions and structured outputs

**After completing these changes, you're ready to implement HITL features!**

---

## 📋 Files in This Codebase That Need Changes

Based on analysis of your codebase, here are the specific files that require migration:

### ✅ Already AI SDK 6 Compatible

Good news! Some parts of your codebase are already using AI SDK 6 patterns:

**Files:**

- `src/app/api/chat/route.ts` - ✅ Already uses `convertToModelMessages`
- `src/lib/ai/workflow/executor/node-executor.ts` - ✅ Already uses `convertToModelMessages`
- `src/lib/ai/tools/**/*` - ✅ All tools already use `inputSchema` (not `parameters`)

### ⚠️ Requires Migration

These files need updates for full AI SDK 6 compatibility:

#### 1. **`src/app/api/chat/actions.ts`**

**Lines to change:**

- **Line 151**: `generateObject()` → `generateText()` + `Output.object()`
- **Line 226**: `generateObject()` → `generateText()` + `Output.object()`

**Current code:**

```typescript
// Line 151 - generateExampleToolSchemaAction
const { object } = await generateObject({
  model,
  schema,
  prompt: generateExampleToolSchemaPrompt({
    toolInfo: options.toolInfo,
    prompt: options.prompt,
  }),
});
return object;

// Line 226 - generateObjectAction
const result = await generateObject({
  model: customModelProvider.getModel(model),
  system: prompt.system,
  prompt: prompt.user || "",
  schema: jsonSchemaToZod(schema),
});
return result.object;
```

**Updated code:**

```typescript
// Line 151 - generateExampleToolSchemaAction
import { generateText, Output } from 'ai';

const { output } = await generateText({
  model,
  output: Output.object({
    schema,
  }),
  prompt: generateExampleToolSchemaPrompt({
    toolInfo: options.toolInfo,
    prompt: options.prompt,
  }),
});
return output;

// Line 226 - generateObjectAction
import { generateText, Output } from 'ai';

const result = await generateText({
  model: customModelProvider.getModel(model),
  system: prompt.system,
  prompt: prompt.user || "",
  output: Output.object({
    schema: jsonSchemaToZod(schema),
  }),
});
return result.output;
```

---

#### 2. **`src/app/api/agent/ai/route.ts`**

**Lines to change:**

- **Line 1**: Update import
- **Line 88**: `streamObject()` → `streamText()` + `Output.object()`

**Current code:**

```typescript
// Line 1
import { streamObject } from "ai";

// Line 88
const result = streamObject({
  model: customModelProvider.getModel(chatModel),
  system,
  prompt: message,
  schema: dynamicAgentTable,
  onFinish: async ({ usage }) => {
    // Track token usage...
  },
});

return result.toTextStreamResponse();
```

**Updated code:**

```typescript
// Line 1
import { streamText, Output } from "ai";

// Line 88
const result = streamText({
  model: customModelProvider.getModel(chatModel),
  system,
  prompt: message,
  output: Output.object({
    schema: dynamicAgentTable,
  }),
  onFinish: async ({ usage }) => {
    // Track token usage...
  },
});

return result.toTextStreamResponse();
```

---

#### 3. **`src/lib/ai/workflow/executor/node-executor.ts`**

**Lines to change:**

- **Line 16**: Update import
- **Line 127**: `generateObject()` → `generateText()` + `Output.object()`

**Current code:**

```typescript
// Line 16
import {
  convertToModelMessages,
  generateObject,
  generateText,
  UIMessage,
} from "ai";

// Line 127-139 (llmNodeExecutor function)
const response = await generateObject({
  model,
  messages: convertToModelMessages(messages),
  schema: jsonSchemaToZod(node.outputSchema.properties.answer),
  maxRetries: 3,
});

return {
  output: {
    totalTokens: response.usage.totalTokens,
    answer: response.object,
  },
};
```

**Updated code:**

```typescript
// Line 16
import {
  convertToModelMessages,
  generateText,
  Output,
  UIMessage,
} from "ai";

// Line 127-139 (llmNodeExecutor function)
const response = await generateText({
  model,
  messages: await convertToModelMessages(messages),
  output: Output.object({
    schema: jsonSchemaToZod(node.outputSchema.properties.answer),
  }),
  maxRetries: 3,
});

return {
  output: {
    totalTokens: response.usage.totalTokens,
    answer: response.output,
  },
};
```

**Note:** Also add `await` to `convertToModelMessages()` at line 117:

```typescript
// Line 117
messages: await convertToModelMessages(messages),
```

---

## ✅ Verified Compatibility

**assistant-ui works with AI SDK 6** because:

- Message format (`UIMessage` with `parts[]`) is UNCHANGED between v5 and v6
- Tool invocation structure is identical
- Breaking changes in v6 are backend-only (don't affect UI components)

## ✅ Verified via Context7: AI SDK v5 → v6 Breaking Changes

After analyzing the official migration documentation, here's what actually changed:

### Breaking Changes in AI SDK 6

| Change | Impact on assistant-ui | Backend Impact | Severity |
|--------|----------------------|----------------|----------|
| `CoreMessage` → `ModelMessage` | ✅ **No impact** - Type rename | ⚠️ **Required** - Update imports | Low |
| `convertToCoreMessages` → `convertToModelMessages` (now async) | ✅ **No impact** - Backend only | ⚠️ **Required** - Add `await` | Medium |
| `generateObject` → `generateText` + `Output.object()` | ✅ **No impact** - Backend only | ⚠️ **Required** - Update API calls | Medium |
| `streamObject` → `streamText` + `Output.object()` | ✅ **No impact** - Backend only | ⚠️ **Required** - Update API calls | Medium |
| `parameters` → `inputSchema` (AI SDK 5.0+) | ✅ **No impact** - Backend only | ⚠️ **Required** - Update tool defs | Low |
| `strictJsonSchema` → per-tool `strict` | ✅ **No impact** - Backend only | ℹ️ **Optional** - Better control | Low |
| **UIMessage format with `parts[]`** | ✅ **UNCHANGED** - Same structure | ✅ **No change** | **None** |
| **Tool invocation structure** | ✅ **UNCHANGED** - Same `tool-*` types | ✅ **No change** | **None** |

### **Critical Finding: Message Format is UNCHANGED** 🎉

The `UIMessage` structure that assistant-ui consumes **is identical** in v5 and v6:

```typescript
// This structure works in BOTH v5 and v6
const message: UIMessage = {
  id: '1',
  role: 'assistant',
  parts: [
    { type: 'text', text: 'Hello' },
    { 
      type: 'tool-email',  // Tool invocation
      toolCallId: 'xyz',
      state: 'output-available',
      input: { to, subject, body },
      output: result
    }
  ]
};
```

### Implementation Approach: AI SDK 6 + assistant-ui + Remote MCP

```bash
pnpm add ai@^6.0.0 @assistant-ui/react @assistant-ui/react-ai-sdk
```

**Why this approach:**

- ✅ **Native tool approval** - Built into AI SDK 6 (`needsApproval: true`)
- ✅ **Remote MCP servers** - Works with Vercel (HTTP/SSE, not stdio)
- ✅ **assistant-ui components** - Reuse mastra-hitl UI code with minimal changes
- ✅ **No Mastra framework** - Simpler, fewer dependencies
- ✅ **Message format unchanged** - assistant-ui works without modification

**Note**: We're adapting **UI components only** from mastra-hitl, not the Mastra framework or agent system.

#### Approach 3: System Prompt + HITL Tools (Recommended)

**Simplest and most reliable**: Don't try to detect multi-step in `needsApproval`. Instead:

1. **Always require approval for destructive MCP tools** (pattern-based)
2. **Use system prompts** to guide AI to use `askForPlanApproval` tool for multi-step workflows
3. **The `askForPlanApproval` tool itself has `needsApproval: true`**, so it blocks execution

This way:

- Single destructive tool → Requires approval ✅
- Multi-step workflow → AI uses `askForPlanApproval` tool (which requires approval) ✅
- Single read-only tool → No approval, executes immediately ✅

```typescript
// Simple pattern-based wrapping
export function wrapMcpToolWithApproval(
  mcpTool: VercelAIMcpTool,
  toolId: string
): Tool {
  const isDestructive = isDestructiveMcpTool(mcpTool._originToolName);
  
  return {
    ...mcpTool,
    needsApproval: isDestructive, // Simple: destructive = approval needed
    execute: mcpTool.execute,
  };
}
```

**Why this works**:

- Destructive tools always require approval (safe)
- Multi-step workflows are handled by the AI using `askForPlanApproval` tool (which has `needsApproval: true`)
- System prompts guide the AI to use plan approval for complex tasks
- No complex state tracking needed
- Works with any MCP tool users add dynamically

**Important Limitation**:

- `needsApproval` function **only receives tool input parameters**, not `messages` or execution context
- We use a **closure/shared state** (tracker) to detect multi-step, but this only works within the same `streamText` call
- For cross-message multi-step detection, rely on system prompts + `askForPlanApproval` tool

**Example Flow**:

```
User: "Research competitors and email me a summary"

Turn 1:
→ AI recognizes this is multi-step
→ AI calls askForPlanApproval tool (needsApproval: true) → Blocks for approval
→ User approves plan
→ AI executes: webSearch (no approval) → gmail_send_email (needsApproval: true) → Blocks again
→ User approves email
→ Email sent
```

**Key Insight**: The `askForPlanApproval` tool itself requires approval, so multi-step workflows are automatically protected. We don't need perfect multi-step detection in individual MCP tools - the plan approval tool handles it.

### 3. Create Tools (With and Without Approval)

#### Example 1: Read-Only Tool (No Approval Needed)

```typescript
// lib/ai/tools/web-search-tool.ts
import { tool } from 'ai';
import { z } from 'zod';

export const webSearchTool = tool({
  description: 'Search the web for information',
  inputSchema: z.object({
    query: z.string().describe('The search query')
  }),
  // NO needsApproval - executes immediately
  execute: async ({ query }) => {
    const results = await searchWeb(query);
    return {
      results,
      message: `Found ${results.length} results for: ${query}`
    };
  }
});
```

#### Example 2: Email Flow (Two-Step Approval Pattern)

The email flow uses a **two-tool pattern** borrowed from mastra-hitl:

1. **proposeEmailTool** - Shows preview, user can edit/approve
2. **sendEmailTool** - Executes the send after finding approved email

```typescript
// lib/ai/tools/propose-email-tool.ts
import { tool } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'crypto';

export const proposeEmailTool = tool({
  description: 'Present a draft email for user review and approval. Returns a handle that can be used to send after approval.',
  inputSchema: z.object({
    to: z.string().email().describe('Email address of the recipient'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body content')
  }),
  needsApproval: true, // 🔥 Blocks until user reviews
  execute: async ({ to, subject, body }) => {
    // Generate a unique handle for this email
    const emailHandle = randomUUID();
    
    return {
      emailHandle,
      to,
      subject,
      body,
      approved: true // User approved in the UI
    };
  }
});

// lib/ai/tools/send-email-tool.ts
import { tool } from 'ai';
import { z } from 'zod';
import { callMCPTool } from '@/lib/mcp/client'; // Your MCP client

export const sendEmailTool = tool({
  description: 'Execute the delivery of a previously approved email using the handle from propose-email. Calls the configured MCP email server.',
  inputSchema: z.object({
    emailHandle: z.string().describe('Handle received from propose-email after approval'),
    mcpServer: z.string().optional().describe('MCP server to use (e.g., "gmail", "outlook"). Defaults to user preference.')
  }),
  execute: async ({ emailHandle, mcpServer }, { messages }) => {
    // Find the approved email in message history
    const proposedEmail = findApprovedEmail(messages, emailHandle);
    
    if (!proposedEmail) {
      throw new Error('Invalid or expired email handle. Please propose the email again.');
    }

    const { to, subject, body } = proposedEmail;
    
    // Call the MCP server's send email tool
    // The MCP server could be Gmail, Outlook, or any other email provider
    const result = await callMCPTool({
      server: mcpServer || 'default-email-server',
      tool: 'send_email', // Or whatever the MCP tool is called
      arguments: {
        to,
        subject,
        body
      }
    });

    return {
      success: true,
      message: `Email sent to ${to} via ${mcpServer || 'default email client'}`,
      mcpResult: result
    };
  }
});

// Helper to find approved email in message history
function findApprovedEmail(messages: any[], handle: string) {
  // Search backwards through messages for the propose-email tool result
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'tool' && msg.toolName === 'proposeEmail') {
      const result = msg.result;
      if (result?.emailHandle === handle && result?.approved) {
        return result;
      }
    }
  }
  return null;
}
```

#### Example 3: Plan Approval Tool (Meta-Tool)

```typescript
// lib/ai/tools/plan-approval-tool.ts
import { tool } from 'ai';
import { z } from 'zod';

export const askForPlanApprovalTool = tool({
  description: 'Request user approval before executing planned actions',
  inputSchema: z.object({
    todos: z.array(z.object({
      text: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed'])
    })),
    explainer: z.string()
  }),
  needsApproval: true, // 🔥 This triggers the approval flow
  execute: async ({ todos, explainer }, { toolCallId }) => {
    // This only runs after user approval
    return {
      approved: true,
      todos,
      message: 'Plan approved and ready for execution'
    };
  }
});
```

### 3. Create HITL System Prompt

Instead of using a separate agent class, we add HITL instructions to the system prompt:

```typescript
// lib/ai/prompts/hitl.ts
export function buildHitlSystemPrompt(): string {
  return `
<human_in_the_loop_requirements>
CRITICAL: You MUST use HITL (Human-in-the-loop) tools for approval workflows. These are MANDATORY, not optional.

EMAIL WORKFLOW (MANDATORY):
1. When user requests to send an email:
   a. ALWAYS use proposeEmail tool FIRST (never call MCP email tools directly)
   b. Wait for user approval (they can edit the email)
   c. Only after approval, use sendEmail tool to execute
   d. NEVER bypass proposeEmail - it's required for all email sending

MULTI-STEP ORCHESTRATION (MANDATORY):
1. When orchestrating multiple MCP tools or complex workflows:
   a. ALWAYS create a plan first using updateTodos
   b. ALWAYS request approval using askForPlanApproval before execution
   c. Wait for explicit user approval
   d. Only then execute the approved plan
   e. Update todos as you progress

DESTRUCTIVE ACTIONS (MANDATORY):
- Email sending → MUST use proposeEmail → sendEmail
- File deletion → MUST use askForPlanApproval first
- Any API mutation → MUST use askForPlanApproval first
- Making purchases → MUST use askForPlanApproval first
- Any task requiring oversight

APPROVAL STRATEGY:
- Simple queries (search, lookup, read): Execute immediately
- Complex multi-step tasks: Create plan → askForPlanApproval → execute
- Destructive actions (email, delete, purchase): Always require approval via tool's needsApproval

EXAMPLES:
- "Search for X" → Use webSearch directly, no plan needed
- "Find X and email the results to Y" → Create plan, get approval, then execute
- "Send email to X" → Tool has needsApproval, will pause for user confirmation
</human_in_the_loop_requirements>
`.trim();
}
```

### 4. Integrate HITL into Existing Chat Route

Update your existing `src/app/api/chat/route.ts` to include HITL tools and system prompt:

```typescript
// src/app/api/chat/route.ts
import { streamText } from 'ai';
import { loadHitlTools } from '@/lib/ai/tools/hitl/load-hitl-tools';
import { buildHitlSystemPrompt } from '@/lib/ai/prompts/hitl';
import { mergeSystemPrompt } from '@/app/api/chat/shared.chat';
// ... other imports

export async function POST(request: Request) {
  // ... existing setup code ...

  const stream = createUIMessageStream({
    execute: async ({ writer: dataStream }) => {
      // ... existing tool loading ...
      const MCP_TOOLS = await loadMcpToolsStateless(session.user.id, {
        mentions,
        allowedMcpServers,
      });
      const WORKFLOW_TOOLS = await loadWorkFlowTools({ ... });
      const APP_DEFAULT_TOOLS = await loadAppDefaultTools({ ... });
      const HITL_TOOLS = loadHitlTools(); // 🔥 Add HITL tools

      // Merge all tools
      const vercelAITooles = safe({
        ...MCP_TOOLS,
        ...WORKFLOW_TOOLS,
        ...HITL_TOOLS, // 🔥 Include HITL tools
        ...APP_DEFAULT_TOOLS,
      })
        .map((t) => {
          // ... existing tool mapping logic ...
        })
        .unwrap();

      // Merge system prompts including HITL instructions
      const systemPrompt = mergeSystemPrompt(
        buildUserSystemPrompt(session.user, userPreferences, agent),
        buildMcpServerCustomizationsSystemPrompt(mcpServerCustomizations),
        buildHitlSystemPrompt(), // 🔥 Add HITL instructions
        !supportToolCall && buildToolCallUnsupportedModelSystemPrompt,
      );

      const result = streamText({
        model,
        system: systemPrompt,
        messages: await convertToModelMessages(messages),
        tools: vercelAITooles,
        experimental_toolApproval: true, // 🔥 Enable tool approval
        onToolApprovalRequest: async ({ toolCall }) => {
          logger.info(`Tool approval requested: ${toolCall.toolName}`);
          dataStream.write({
            type: 'tool-approval-request',
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            args: toolCall.args,
          });
          return undefined; // Return undefined to pause execution
        },
        // ... other streamText options ...
      });

      // ... rest of existing code ...
    },
  });

  return stream.toDataStreamResponse();
}
```

### 5. React UI Components (Adapted from mastra-hitl)

We can directly port the UI components since they're just React:

#### A. Plan Approval Component

```typescript
// components/tools/plan-approval.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, Clock } from 'lucide-react';

interface Todo {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export function PlanApprovalUI({ 
  todos: initialTodos, 
  onApprove, 
  onReject 
}: {
  todos: Todo[];
  onApprove: (todos: Todo[]) => void;
  onReject: () => void;
}) {
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleApprove = async () => {
    setIsProcessing(true);
    await onApprove(todos);
  };

  const handleReject = async () => {
    setIsProcessing(true);
    await onReject();
  };

  const handleTodoChange = (index: number, text: string) => {
    setTodos(prev => {
      const next = [...prev];
      next[index] = { ...next[index], text };
      return next;
    });
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="border-b px-4 py-2 text-xs font-medium uppercase text-slate-500">
        Plan Approval Required
      </div>

      <div className="px-4 py-3">
        <ul className="flex flex-col gap-1">
          {todos.map((todo, index) => {
            const Icon = todo.status === 'completed' ? CheckCircle2 
                       : todo.status === 'in_progress' ? Clock 
                       : Circle;
            
            return (
              <li key={index} className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-slate-400" />
                <input
                  value={todo.text}
                  onChange={(e) => handleTodoChange(index, e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none"
                  disabled={isProcessing}
                />
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isProcessing}
          >
            Reject Plan
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isProcessing || todos.length === 0}
          >
            Approve & Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
```

#### B. Email Preview Component (Key Feature!)

This component shows the email draft inline in the chat with approve/reject buttons:

```typescript
// components/tools/email-preview.tsx
'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmailPreviewProps {
  to: string;
  subject: string;
  body: string;
  onApprove: (body: string) => void;
  onReject: () => void;
  isLoading?: boolean;
}

export function EmailPreviewUI({
  to,
  subject,
  body: initialBody,
  onApprove,
  onReject,
  isLoading = false
}: EmailPreviewProps) {
  const [body, setBody] = useState(initialBody);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isRejected, setIsRejected] = useState(false);

  const handleApprove = useCallback(() => {
    setIsConfirmed(true);
    onApprove(body);
  }, [body, onApprove]);

  const handleReject = useCallback(() => {
    setIsRejected(true);
    onReject();
  }, [onReject]);

  const isCompleted = isConfirmed || isRejected;
  const approved = isConfirmed;

  const headerStatus = isCompleted
    ? {
        Icon: approved ? CheckCircle2 : AlertCircle,
        label: approved ? 'Email Approved' : 'Email Rejected',
        className: approved ? 'text-emerald-600' : 'text-red-600'
      }
    : null;

  return (
    <div
      className={cn(
        'my-3 overflow-hidden rounded-lg border bg-white shadow-sm',
        isRejected ? 'border-red-400' : 'border-slate-200'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Email Approval
        {headerStatus && (
          <span
            className={cn(
              'ml-auto flex items-center gap-1 text-xs font-semibold',
              headerStatus.className
            )}
          >
            <headerStatus.Icon className="h-4 w-4" aria-hidden />
            {headerStatus.label}
          </span>
        )}
      </div>

      {/* Email Details */}
      <div className="divide-y divide-slate-200 text-sm text-slate-700">
        {/* To Field */}
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
            To
          </span>
          <span className="ml-4 flex-1 break-words text-right text-slate-700">
            {to}
          </span>
        </div>

        {/* Subject Field */}
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Subject
          </span>
          <span className="ml-4 flex-1 break-words text-right text-slate-700">
            {subject}
          </span>
        </div>

        {/* Body Field (Editable) */}
        <div className="px-4 py-4">
          {isLoading ? (
            <div className="space-y-2" aria-live="polite" aria-busy="true">
              <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200" />
              <span className="sr-only">Generating email body…</span>
            </div>
          ) : isCompleted ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {body}
            </p>
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full resize-none whitespace-pre-wrap rounded border border-slate-200 p-2 text-sm leading-relaxed text-slate-700 focus:border-slate-400 focus:outline-none focus:ring-0"
              rows={Math.min(body.split('\n').length + 1, 15)}
              placeholder="Email body..."
            />
          )}
        </div>
      </div>

      {/* Action Buttons */}
      {!isCompleted && (
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleReject}
            disabled={isLoading}
          >
            Reject
          </Button>
          <Button
            type="button"
            onClick={handleApprove}
            disabled={isLoading}
          >
            Approve & Send
          </Button>
        </div>
      )}
    </div>
  );
}
```

#### C. Request Input Component

```typescript
// components/tools/request-input.tsx
'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RequestInputProps {
  label: string;
  placeholder: string;
  onSubmit: (value: string) => void;
}

export function RequestInputUI({
  label,
  placeholder,
  onSubmit
}: RequestInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedValue, setSubmittedValue] = useState('');

  const trimmedInput = inputValue.trim();
  const isInputValid = trimmedInput.length > 0;

  const handleSubmit = useCallback(() => {
    if (!isInputValid) return;

    setSubmittedValue(trimmedInput);
    setIsSubmitted(true);
    onSubmit(trimmedInput);
  }, [trimmedInput, isInputValid, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !isSubmitted && isInputValid) {
        handleSubmit();
      }
    },
    [handleSubmit, isSubmitted, isInputValid]
  );

  return (
    <div className="my-3">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          User Input Required
          {isSubmitted && (
            <span className="ml-auto flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Submitted
            </span>
          )}
        </div>

        <div className="space-y-3 px-4 py-4 text-sm text-slate-600">
          <p className="text-slate-700">{label}</p>

          {isSubmitted ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-700">
              {submittedValue}
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                Provide the requested information so the assistant can continue.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  className={cn(
                    'h-10 rounded-md border-slate-200 bg-white text-sm text-slate-700',
                    'focus-visible:border-slate-400 focus-visible:ring-0'
                  )}
                  aria-label={label}
                  placeholder={placeholder}
                  onChange={(e) => setInputValue(e.target.value)}
                  value={inputValue}
                  disabled={isSubmitted}
                  onKeyDown={handleKeyDown}
                />
                <Button
                  type="button"
                  className="sm:self-start"
                  onClick={handleSubmit}
                  disabled={!isInputValid || isSubmitted}
                >
                  Submit
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 6. Chat Component with Tool Approval

This integrates all the UI components and handles different tool types:

```typescript
// app/(chat)/chat/page.tsx (or wherever your chat page is)
'use client';

import { useChat } from 'ai/react';
import { useState } from 'react';
import { PlanApprovalUI } from '@/components/tools/plan-approval';
import { EmailPreviewUI } from '@/components/tools/email-preview';
import { RequestInputUI } from '@/components/tools/request-input';
import { randomUUID } from 'crypto';

export default function HITLChatPage() {
  const [pendingApprovals, setPendingApprovals] = useState<Map<string, any>>(new Map());
  
  const { messages, input, handleInputChange, handleSubmit, append } = useChat({
    api: '/api/chat', // Use existing chat route with HITL integrated
    onToolApprovalRequest: (toolCall) => {
      // Store pending approval with its toolCallId
      setPendingApprovals(prev => new Map(prev).set(toolCall.toolCallId, toolCall));
    }
  });

  // Generic approval handler
  const handleToolApproval = async (toolCallId: string, result: any) => {
    await append({
      role: 'tool',
      content: JSON.stringify(result),
      toolCallId
    });
    
    // Remove from pending
    setPendingApprovals(prev => {
      const next = new Map(prev);
      next.delete(toolCallId);
      return next;
    });
  };

  // Specific handlers for each tool type
  const handlePlanApprove = (toolCallId: string) => async (todos: any[]) => {
    await handleToolApproval(toolCallId, { approved: true, todos });
  };

  const handlePlanReject = (toolCallId: string) => async () => {
    await handleToolApproval(toolCallId, { approved: false, todos: [] });
  };

  const handleEmailApprove = (toolCallId: string, to: string, subject: string) => async (body: string) => {
    const emailHandle = randomUUID();
    await handleToolApproval(toolCallId, {
      emailHandle,
      to,
      subject,
      body,
      approved: true
    });
  };

  const handleEmailReject = (toolCallId: string) => async () => {
    await handleToolApproval(toolCallId, { approved: false });
  };

  const handleInputSubmit = (toolCallId: string) => async (value: string) => {
    await handleToolApproval(toolCallId, { result: value });
  };

  // Render tool UI based on tool name
  const renderToolUI = (toolCall: any) => {
    const { toolCallId, toolName, args } = toolCall;

    switch (toolName) {
      case 'askForPlanApproval':
        return (
          <PlanApprovalUI
            key={toolCallId}
            todos={args.todos}
            onApprove={handlePlanApprove(toolCallId)}
            onReject={handlePlanReject(toolCallId)}
          />
        );

      case 'proposeEmail':
        return (
          <EmailPreviewUI
            key={toolCallId}
            to={args.to}
            subject={args.subject}
            body={args.body}
            onApprove={handleEmailApprove(toolCallId, args.to, args.subject)}
            onReject={handleEmailReject(toolCallId)}
          />
        );

      case 'requestInput':
        return (
          <RequestInputUI
            key={toolCallId}
            label={args.label}
            placeholder={args.placeholder}
            onSubmit={handleInputSubmit(toolCallId)}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((message) => (
          <div key={message.id}>
            {/* User Message */}
            {message.role === 'user' && (
              <div className="mb-4 text-right">
                <span className="inline-block rounded-lg bg-blue-500 px-4 py-2 text-white">
                  {message.content}
                </span>
              </div>
            )}

            {/* Assistant Message */}
            {message.role === 'assistant' && (
              <div className="mb-4">
                <span className="inline-block rounded-lg bg-gray-200 px-4 py-2">
                  {message.content}
                </span>
              </div>
            )}

            {/* Tool Invocations */}
            {message.toolInvocations?.map((tool) => (
              <div key={tool.toolCallId}>
                {/* Show completed tool results */}
                {tool.state === 'result' && (
                  <div className="mb-4 text-sm text-gray-600">
                    ✓ {tool.toolName} completed
                  </div>
                )}
                
                {/* Show loading state */}
                {tool.state === 'call' && (
                  <div className="mb-4 text-sm text-gray-500">
                    ⏳ Calling {tool.toolName}...
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Render pending approval UIs */}
        {Array.from(pendingApprovals.values()).map(renderToolUI)}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="border-t p-4">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Type a message..."
          className="w-full rounded-lg border px-4 py-2"
        />
      </form>
    </div>
  );
}
```

## Example Workflows

### Scenario 1: Simple Web Search (No Approval)

**User**: "Search for the latest AI SDK updates"

**Agent Flow**:

```
1. Receives request
2. Calls webSearchTool() immediately (no needsApproval)
3. Returns results
```

**UI**: Shows search tool invocation + results inline. No approval dialog.

---

### Scenario 2: Complex Multi-Step Task with Email (Full Flow)

**User**: "Research competitors and email me a summary"

**Agent Flow**:

```
1. Analyzes request (multi-step + destructive action)
2. Creates plan:
   - Search for competitors
   - Analyze findings
   - Draft email
   - Send email
3. Calls updateTodosTool() → Shows todo list in UI
4. Calls askForPlanApprovalTool() → Blocks execution
   → UI shows editable plan with Approve/Reject buttons
5. User reviews plan and clicks "Approve & Continue"
6. Executes tasks sequentially:
   - webSearch("competitors") - executes immediately (no approval needed)
   - Analyzes results
   - updateTodos() - marks "Search competitors" as completed
   - Calls proposeEmailTool({to, subject, body}) - needsApproval blocks
     → EmailPreviewUI appears showing:
       ┌─────────────────────────────────┐
       │ Email Approval                  │
       ├─────────────────────────────────┤
       │ To: user@example.com            │
       │ Subject: Competitor Analysis    │
       │ Body: [Editable textarea]       │
       │                                 │
       │ [Reject] [Approve & Send]       │
       └─────────────────────────────────┘
7. User edits body text if needed, clicks "Approve & Send"
8. proposeEmail returns { emailHandle, approved: true }
9. Agent calls sendEmailTool({ emailHandle })
10. sendEmail finds approved email in history, sends via Resend
11. Updates todos to completed
```

**UI Flow**:

1. Plan approval card → User edits/approves
2. Todo list shows progress in real-time
3. Email preview card appears → User edits/approves
4. Success message + final todo state

---

### Scenario 3: Single Destructive Action (Tool-Level Approval)

**User**: "Send an email to <john@example.com> with subject 'Hello'"

**Agent Flow**:

```
1. Receives request (single action, but destructive)
2. Prepares email content
3. Calls sendEmailTool() → needsApproval blocks execution
   → UI shows email preview with Approve/Reject
4. User approves
5. Sends email
```

**UI**: Shows email preview dialog → confirmation → success message

No plan approval needed because it's a single action, but the tool itself requires approval.

---

## Implementation Overview

| Aspect | Our Implementation |
|--------|-------------------|
| **Framework** | AI SDK 6 (no Mastra) |
| **Tool Approval** | Native `needsApproval: true` |
| **Approval Strategy** | Selective - only risky actions |
| **MCP Servers** | Remote (HTTP/SSE) - Vercel compatible |
| **Email Backend** | User's actual account via MCP (Gmail, Outlook, etc.) |
| **Authentication** | OAuth tokens stored in database |
| **UI Components** | Adapted from mastra-hitl (assistant-ui patterns) |
| **Type Safety** | Native AI SDK 6 type inference |
| **Dependencies** | `ai@6`, `@assistant-ui/react` |
| **Deployment** | Works on Vercel (serverless) |

### Key Advantages of MCP + Approval Approach

#### 1. **Universal Approval Layer**

```
Your Implementation: Tool Approval → MCP Tool → User's Service
mastra-hitl: Tool Approval → Hardcoded Service
```

The approval UI works with **any MCP tool**:

- Email (Gmail, Outlook, custom)
- Calendar (Google Calendar, Outlook Calendar)
- File operations (Google Drive, Dropbox)
- Communication (Slack, Discord)
- Database operations
- API calls

#### 2. **User's Actual Accounts**

- User authenticates their own Gmail via MCP OAuth
- Emails come from **their actual email address**
- No shared API keys, no rate limits
- Works with enterprise accounts (SSO, 2FA, etc.)

#### 3. **Zero Configuration for Providers**

```typescript
// mastra-hitl: Requires API key setup
RESEND_API_KEY=re_xxx

// Your approach: User configures once in MCP
// Agent just calls their configured server
await callMCPTool('gmail-server', 'send_email', { to, subject, body });
```

#### 4. **Dynamic Provider Selection**

```typescript
// User can have multiple email accounts
proposeEmailTool({
  to: "client@example.com",
  subject: "Proposal",
  body: "...",
  mcpServer: "work-gmail" // Send from work account
});

proposeEmailTool({
  to: "friend@example.com",
  subject: "Hey!",
  body: "...",
  mcpServer: "personal-gmail" // Send from personal account
});
```

#### 5. **Extensible to Any MCP Tool**

The approval pattern works for ANY destructive MCP action:

```typescript
// File deletion with approval
export const deleteFileTool = createApprovedMCPTool({
  mcpServerName: 'google-drive',
  mcpToolName: 'delete_file',
  inputSchema: z.object({ fileId: z.string() }),
  description: 'Delete a file from Google Drive'
});

// Slack message with approval
export const sendSlackMessageTool = createApprovedMCPTool({
  mcpServerName: 'slack',
  mcpToolName: 'send_message',
  inputSchema: z.object({ channel: z.string(), text: z.string() }),
  description: 'Send a Slack message'
});

// Database update with approval
export const updateDatabaseTool = createApprovedMCPTool({
  mcpServerName: 'postgres',
  mcpToolName: 'execute_query',
  inputSchema: z.object({ query: z.string() }),
  description: 'Execute a database query'
});
```

All of these get the same beautiful approval UX!

## Key Insight: Mandatory vs Selective Approval

### mastra-hitl's Approach (Mandatory Plan Approval)

The mastra-hitl repository enforces a **mandatory workflow** for EVERY request:

```typescript
instructions: `
  MANDATORY WORKFLOW for EVERY request:
  1. Create a plan using updateTodosTool
  2. Request approval via ask-for-plan-approval
  3. Wait for explicit user approval
  4. Execute only approved tasks
  - NEVER act without approval - even for simple tasks
```

**Pros**:

- Maximum transparency
- User always knows what will happen
- Good for high-stakes scenarios (legal, medical, financial)

**Cons**:

- Friction for simple queries like "what's the weather?"
- Poor UX for read-only operations
- User fatigue from constant approvals

### Our SDK 6 Approach (Selective Approval)

We use a **tiered approval system**:

1. **No approval**: Read-only tools (search, lookup, calculations)
2. **Tool-level approval**: Destructive actions (email, delete, purchase)
3. **Plan approval**: Complex multi-step workflows with mixed actions

**Pros**:

- Better UX - approval matches risk level
- Fast responses for simple queries
- Still safe for destructive actions

**Cons**:

- Agent needs good judgment on when to create plans
- More complex instructions

### When to Use Each Approach?

**Use Mandatory Plan Approval (mastra-hitl style)** if:

- Every action has legal/compliance implications
- User must review ALL operations
- Building for regulated industries
- User explicitly wants full control

**Use Selective Approval (our approach)** if:

- Building general-purpose AI assistants
- Want good UX for simple queries
- Trust the agent to categorize tasks appropriately
- Need to balance safety with usability

You can easily switch between approaches by updating the agent instructions!

## ✅ You CAN Use mastra-hitl UI Components with AI SDK 6

Since the message format is unchanged, mastra-hitl UI components work with **minimal adaptation**:

### What Works As-Is ✅

**UI Components** (95% ready):

- `/components/tools/plan-approval.tsx` - Change `addResult()` → `onApprove()/onReject()`
- `/components/tools/human-in-the-loop.tsx` - Change `addResult()` → callback props
- `/components/tools/todo.tsx` - Works directly, no changes needed
- `/components/ui/*` - All shadcn/ui primitives work directly

**The UI JSX is identical** - you just need to:

1. Remove `makeAssistantToolUI()` wrapper
2. Accept props instead of `{ args, result, status, addResult }`
3. Call `onApprove(data)` instead of `addResult(data)`

### What Needs Replacement ❌

**Backend/Tool Layer**:

- `/app/api/chat/route.ts` - Use AI SDK 6's `streamText` with `experimental_toolApproval: true`
- System prompts - Add `buildHitlSystemPrompt()` to guide AI behavior
- `/mastra/tools/*` - Replace `createTool()` with SDK 6 `tool()` (with `needsApproval: true` where needed)

**The key insight**: It's not a rewrite, it's a find-and-replace for tool definitions and API calls. The beautiful UI stays the same!

## Email UX: Direct from mastra-hitl

### The Email Component Is Perfectly Reusable

The `ProposeEmailToolUI` component from mastra-hitl (`/components/tools/human-in-the-loop.tsx`) is **95% copy-paste ready**. Here's the exact adaptation:

#### mastra-hitl Version (SDK 5 + Mastra)

```typescript
export const ProposeEmailToolUI = makeAssistantToolUI({
  toolName: "proposeEmailTool",
  render: function Render({ args, result, addResult, status }) {
    const handleConfirm = useCallback(() => {
      addResult({
        emailHandle: generateId(),
        to: args.to,
        subject: args.subject,
        body: emailBody,
        approved: true,
      });
    }, [addResult, args, emailBody]);
    
    // ... UI code (keep all of it!)
  }
});
```

#### Your AI SDK 6 Version (Direct Port)

```typescript
export function EmailPreviewUI({ to, subject, body, onApprove, onReject }) {
  const [emailBody, setEmailBody] = useState(body);
  
  const handleConfirm = useCallback(() => {
    onApprove(emailBody); // Only callback name changes!
  }, [onApprove, emailBody]);
  
  // Copy the ENTIRE UI JSX from mastra-hitl - it's identical!
  return (
    <div className="my-3 overflow-hidden rounded-lg border bg-white shadow-sm">
      {/* Exact same structure as mastra-hitl */}
    </div>
  );
}
```

**What Changes:**

- ✅ Remove `makeAssistantToolUI` wrapper
- ✅ Change `addResult()` → `onApprove()` / `onReject()`
- ✅ Accept props instead of `{ args, result, status }`
- ❌ **Keep everything else** - all the UI logic, styling, loading states, etc.

### Email Flow Pattern: The Two-Tool Approach

Both mastra-hitl and our SDK 6 version use the same elegant pattern:

```
1. proposeEmailTool() 
   → Shows preview UI
   → User edits body
   → User approves
   → Returns { emailHandle, body, approved: true }

2. sendEmailTool({ emailHandle })
   → Finds approved email in history
   → Sends via Resend API
   → Returns success
```

This two-step pattern ensures:

- User can edit the email content
- Agent can't send until explicitly approved
- Handle validates the email was actually approved
- Perfect for compliance/audit trails

### 🔥 Using MCP Servers Instead of Resend

The approval pattern works **perfectly with MCP servers**! Instead of hardcoding Resend, you can use any MCP server that provides email functionality:

**Supported MCP Email Providers:**

- Gmail MCP Server
- Outlook MCP Server  
- Any custom email MCP implementation

**The Pattern:**

```
User → Agent → proposeEmailTool (approval layer) → sendEmailTool → MCP Server → Email Client
```

**Architecture:**

```typescript
// 1. Propose Email (Shows UI, no MCP call yet)
proposeEmailTool({
  to: "user@example.com",
  subject: "Hello",
  body: "Draft content"
})
→ User sees preview, edits body
→ User clicks "Approve & Send"
→ Returns { emailHandle, approved: true, body: editedBody }

// 2. Send Email (Calls MCP after approval)
sendEmailTool({
  emailHandle: "uuid-123"
})
→ Finds approved email in history
→ Calls MCP server: callMCPTool('gmail', 'send_email', { to, subject, body })
→ MCP server sends via Gmail API
→ Returns success
```

**Benefits of MCP Approach:**

- ✅ Works with user's actual email account (Gmail, Outlook, etc.)
- ✅ No API keys needed (MCP handles auth via OAuth)
- ✅ User controls which email client to use
- ✅ Approval layer works regardless of provider
- ✅ Can switch providers without changing approval UI

## MCP Integration Pattern: Universal Approval Layer

### How This Works with Your Existing MCP Setup

Your codebase already has MCP integration (`@modelcontextprotocol/sdk`). The approval pattern sits **in front of** any MCP tool, giving you human-in-the-loop for any destructive MCP action.

#### Complete MCP Email Flow

```typescript
// lib/ai/tools/mcp-email-wrapper.ts
import { tool } from 'ai';
import { z } from 'zod';
import { callMCPTool } from '@/lib/mcp-client'; // Your existing MCP client

/**
 * Step 1: Propose Email (Approval Layer)
 * This tool shows the preview UI and collects user approval
 */
export const proposeEmailTool = tool({
  description: 'Draft an email and show it to the user for approval before sending',
  inputSchema: z.object({
    to: z.string().email().describe('Recipient email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body content'),
    // Optional: Let agent specify which MCP server to use
    mcpServer: z.string().optional().describe('MCP server name (e.g., "gmail-server")')
  }),
  needsApproval: true, // 🔥 This triggers the UI preview
  execute: async ({ to, subject, body, mcpServer }) => {
    // This runs AFTER user approval
    // Just return the approved email data
    const emailHandle = crypto.randomUUID();
    
    return {
      emailHandle,
      to,
      subject,
      body,
      mcpServer: mcpServer || 'default',
      approved: true,
      timestamp: new Date().toISOString()
    };
  }
});

/**
 * Step 2: Send Email (MCP Execution)
 * This tool actually calls the MCP server to send
 */
export const sendEmailTool = tool({
  description: 'Send a previously approved email via the configured MCP email server',
  inputSchema: z.object({
    emailHandle: z.string().describe('Handle from the approved propose-email call')
  }),
  execute: async ({ emailHandle }, { messages }) => {
    // Find the approved email
    const approvedEmail = findApprovedEmail(messages, emailHandle);
    
    if (!approvedEmail) {
      throw new Error('Email handle not found or not approved. Please use propose-email first.');
    }

    const { to, subject, body, mcpServer } = approvedEmail;

    try {
      // Call the MCP server's email tool
      // This could be Gmail, Outlook, or any MCP provider
      const mcpResult = await callMCPTool({
        serverName: mcpServer,
        toolName: 'send_email', // Standard MCP email tool name
        args: {
          to,
          subject,
          body
        }
      });

      return {
        success: true,
        message: `Email sent to ${to}`,
        mcpServer,
        mcpResult
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to send email via ${mcpServer}: ${error.message}`
      };
    }
  }
});

// Helper function
function findApprovedEmail(messages: any[], handle: string) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'tool' && msg.toolName === 'proposeEmail') {
      const result = msg.result;
      if (result?.emailHandle === handle && result?.approved) {
        return result;
      }
    }
  }
  return null;
}
```

## Adapting UI Components from mastra-hitl

We're **only using the UI code** from mastra-hitl, not the Mastra framework. Here's how to adapt the components:

### Step 1: Copy the UI Component Structure

The mastra-hitl repo has beautiful UI components in `/components/tools/`. Copy the **JSX/styling only**:

```typescript
// mastra-hitl uses this pattern:
export const ProposeEmailToolUI = makeAssistantToolUI({
  toolName: "proposeEmailTool",
  render: function Render({ args, result, addResult, status }) {
    // ... UI JSX here ...
  }
});

// We adapt it to:
export function EmailPreviewUI({
  to,
  subject,
  body,
  onApprove,
  onReject,
  isLoading = false
}: EmailPreviewProps) {
  // ... same UI JSX, just change callbacks ...
}
```

### Step 2: Change Only the Callbacks

The UI JSX stays **identical**. Only change:

- Remove `makeAssistantToolUI()` wrapper
- Change `addResult({ ... })` → `onApprove(...)` or `onReject()`
- Accept props directly instead of `{ args, result, status }`

That's it! The beautiful email preview, plan approval, and input components from mastra-hitl work perfectly with AI SDK 6.

## Next Steps

See the implementation examples in:

- `lib/ai/tools/hitl/` - HITL tool definitions with approval
- `lib/ai/prompts/hitl.ts` - HITL system prompt builder
- `app/api/chat/route.ts` - Main chat route (HITL integrated here)
- `components/tools/` - UI components for approval

## Quick Start: Adding MCP Email with Approval to Your Codebase

Your project already has `@modelcontextprotocol/sdk` installed. Here's how to add email approval with AI SDK 6 + assistant-ui components:

### Step 1: Install AI SDK 6

```bash
pnpm add ai@^6.0.0
```

**Note**: Your project already has `@modelcontextprotocol/sdk`, so you're ready for MCP integration!

### Step 2: (Optional) Install assistant-ui for Pre-built Components

```bash
pnpm add @assistant-ui/react @assistant-ui/react-ai-sdk
```

This gives you the beautiful email preview/plan approval UI from mastra-hitl, which works with AI SDK 6!

### Step 3: Create MCP Email Tools with Approval

Create `src/lib/ai/tools/mcp-email-tools.ts` using the complete MCP integration example from the guide above.

### Step 4: Create Email Preview UI Component

Copy the `EmailPreviewUI` component from the guide into `src/components/tools/email-preview.tsx`.

**Tip**: If you installed assistant-ui, you can adapt the `ProposeEmailToolUI` from mastra-hitl by changing `addResult()` to `onApprove()`.

### Step 5: Integrate HITL into Existing Chat Route

Update your existing `src/app/api/chat/route.ts`:

```typescript
// src/app/api/chat/route.ts
import { loadHitlTools } from '@/lib/ai/tools/hitl/load-hitl-tools';
import { buildHitlSystemPrompt } from '@/lib/ai/prompts/hitl';

// Inside your POST handler, add:
const HITL_TOOLS = loadHitlTools(); // proposeEmail, sendEmail, askForPlanApproval, etc.

// Merge HITL tools with existing tools
const vercelAITooles = safe({
  ...MCP_TOOLS,
  ...WORKFLOW_TOOLS,
  ...HITL_TOOLS, // 🔥 Add HITL tools
  ...APP_DEFAULT_TOOLS,
})
  .map((t) => { /* existing mapping logic */ })
  .unwrap();

// Add HITL system prompt
const systemPrompt = mergeSystemPrompt(
  buildUserSystemPrompt(session.user, userPreferences, agent),
  buildMcpServerCustomizationsSystemPrompt(mcpServerCustomizations),
  buildHitlSystemPrompt(), // 🔥 Add HITL instructions
  !supportToolCall && buildToolCallUnsupportedModelSystemPrompt,
);

// Enable tool approval in streamText
const result = streamText({
  model,
  system: systemPrompt,
  messages: await convertToModelMessages(messages),
  tools: vercelAITooles,
  experimental_toolApproval: true, // 🔥 Enable tool approval
  onToolApprovalRequest: async ({ toolCall }) => {
    // Handle approval requests
  },
  // ... rest of config
});
```

### Step 6: Update Chat Component

Add email preview handling to your chat UI (see "Chat Component with Tool Approval" section above).

### Step 7: Configure MCP Email Server

Users configure their email server in your app settings or config file:

```typescript
// User's MCP configuration (stored in DB or config)
{
  "gmail-server": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-gmail"],
    "env": {
      "GOOGLE_CLIENT_ID": process.env.GOOGLE_CLIENT_ID,
      "GOOGLE_CLIENT_SECRET": process.env.GOOGLE_CLIENT_SECRET
    }
  }
}
```

That's it! Now when the agent wants to send an email:

1. Calls `proposeEmail()` → Shows preview UI with editable body
2. User edits and approves
3. Agent calls `sendEmail()` → Sends via their Gmail/Outlook/etc. MCP server

## Summary: Our Implementation Stack

### AI SDK 6 + assistant-ui + Remote MCP

**What We Use:**

- ✅ **AI SDK 6** - Native tool approval with `needsApproval: true`
- ✅ **assistant-ui** - UI components (adapted code from mastra-hitl)
- ✅ **Remote MCP servers** - HTTP/SSE (works on Vercel)
- ✅ **No Mastra framework** - Direct AI SDK 6 implementation
- ✅ **User's actual accounts** - Gmail, Outlook, etc. via MCP
- ✅ **Selective approval** - Only approve risky actions, not reads

**What We DON'T Use:**

- ❌ Mastra framework or agents
- ❌ Local stdio MCP servers (don't work on Vercel)
- ❌ Hardcoded email services like Resend
- ❌ Mandatory plan approval for every action

### vs No Approval

- ✅ User reviews every email before sending
- ✅ Can edit email body inline
- ✅ Audit trail of approvals
- ✅ Prevents unwanted communications

### vs Manual MCP Calls

- ✅ Beautiful inline UI for approval
- ✅ Edit capabilities before sending
- ✅ Type-safe tool definitions
- ✅ Seamless integration with chat UI

## What You Get

```typescript
// User: "Email john@example.com about the meeting tomorrow"

// 1. Agent drafts email → Calls proposeEmailTool with needsApproval: true
// 2. Execution pauses → Shows inline preview in chat:

┌────────────────────────────────────────┐
│ Email Approval                         │
├────────────────────────────────────────┤
│ To: john@example.com                   │
│ Subject: Tomorrow's Meeting            │
│                                        │
│ Hi John,                              │
│                                        │
│ [Editable textarea - user can modify] │
│                                        │
│ Looking forward to it!                │
│                                        │
│ Best,                                 │
│ [Your name]                           │
│                                        │
│ [Reject] [Approve & Send]             │
└────────────────────────────────────────┘

// 3. User edits body, clicks "Approve & Send"
// 4. Agent receives approval → Calls sendEmailTool with emailHandle
// 5. sendEmailTool → Calls remote MCP server (Gmail, Outlook, etc.)
// ✓ Email sent from user's actual account to john@example.com
```

**Flow**: AI SDK 6 approval → User edits/approves → Remote MCP server → User's email client

## Key Takeaways

1. ✅ **AI SDK 6 only** - No Mastra framework needed, native `needsApproval` support
2. ✅ **Remote MCP servers** - HTTP/SSE endpoints work on Vercel (stdio doesn't)
3. ✅ **assistant-ui components** - Adapt UI code from mastra-hitl with minimal changes
4. ✅ **Universal approval pattern** - Works with any MCP tool (email, Slack, calendar, etc.)
5. ✅ **Selective approval** - Only approve risky actions, not reads
6. ✅ **User's actual accounts** - OAuth tokens for Gmail, Outlook, etc. via MCP

## References

- [AI SDK 6 Announcement](https://vercel.com/blog/ai-sdk-6) - Native tool approval feature
- [AI SDK Tool Approval Docs](https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling#tool-execution-approval) - `needsApproval` documentation
- [MCP Protocol](https://modelcontextprotocol.io) - Model Context Protocol specification
- [AI SDK MCP Integration](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools) - Remote MCP servers with AI SDK
- [assistant-ui](https://assistant-ui.com) - UI component patterns
- [mastra-hitl UI Code](https://github.com/assistant-ui/mastra-hitl/tree/main/components/tools) - Source for UI components (we adapt these)
- [Your Project's MCP Setup](../mcp-server-setup-and-tool-testing.md) - Existing remote MCP configuration
