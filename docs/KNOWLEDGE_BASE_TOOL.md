# Knowledge Base Search Tool - LLM Integration

## Overview

The Knowledge Base Search Tool (`searchKnowledgeBase`) allows the LLM to retrieve relevant information from uploaded documents during conversations. This creates a true **Retrieval-Augmented Generation (RAG)** experience where the LLM can answer questions based on your project documents.

## How It Works

```
User Question → LLM decides to search → Tool called with query → Vector search → Relevant chunks → LLM uses context → Response
```

### Example Conversation:

**User**: "What does the API documentation say about authentication?"

**LLM**: *Internally calls `searchKnowledgeBase` tool*
```json
{
  "query": "API authentication methods",
  "limit": 5
}
```

**Tool Returns**:
```json
{
  "success": true,
  "results": [
    {
      "content": "The API uses JWT tokens for authentication...",
      "source": "api-docs.pdf",
      "relevance": "92.3%"
    }
  ],
  "context": "The API uses JWT tokens for authentication..."
}
```

**LLM**: *Uses the context to answer* "According to your API documentation, authentication uses JWT tokens..."

## Tool Registration

### Option 1: Automatic Registration (Recommended)

If you have an automatic tool registration system, add to your tool config:

```typescript
// In your chat API or tool configuration
import { searchKnowledgeBase } from "@/lib/ai/tools/knowledge-base/search-knowledge-base";

const tools = {
  ...existingTools,
  searchKnowledgeBase: searchKnowledgeBase(session.user.id),
};
```

### Option 2: Manual Registration

Find where tools are registered (likely in `src/app/api/chat/` or similar) and add:

```typescript
import { searchKnowledgeBase } from "@/lib/ai/tools/knowledge-base/search-knowledge-base";
import { DefaultToolName } from "@/lib/ai/tools";

// Add to your tools object
const tools = {
  [DefaultToolName.SearchKnowledgeBase]: searchKnowledgeBase(userId),
  // ... other tools
};
```

### Option 3: Per-Project Tools

If tools are project-specific:

```typescript
// When user selects a project in chat
const projectTools = {
  searchKnowledgeBase: createTool({
    // ... tool definition with projectId pre-filled
    execute: async ({ query, limit, threshold }) => {
      return await fetch(`/api/projects/${projectId}/search`, {
        method: "POST",
        body: JSON.stringify({ query, limit, threshold }),
      });
    },
  }),
};
```

## API Endpoints

### Project-Specific Search
```typescript
POST /api/projects/{projectId}/search
{
  "query": "your search query",
  "limit": 5,
  "threshold": 0.7
}
```

### Global Search (All User Documents)
```typescript
POST /api/knowledge-base/search
{
  "query": "your search query",
  "projectId": "optional-project-id",
  "limit": 5,
  "threshold": 0.7
}
```

## Tool Schema

The tool accepts these parameters:

```typescript
{
  query: string;        // Required: What to search for
  projectId?: string;   // Optional: Limit to specific project
  limit?: number;       // Optional: Max results (default: 5)
  threshold?: number;   // Optional: Min similarity 0-1 (default: 0.7)
}
```

## Tool Response Format

```typescript
{
  success: boolean;
  message: string;
  results: Array<{
    rank: number;
    content: string;
    source: string;        // Filename
    relevance: string;     // "92.3%"
    metadata: object;
  }>;
  context: string;         // All content joined for easy LLM consumption
}
```

## Usage Examples

### Example 1: Question Answering

**User**: "What's the refund policy?"

**LLM Tool Call**:
```json
{
  "tool": "searchKnowledgeBase",
  "parameters": {
    "query": "refund policy return money back"
  }
}
```

### Example 2: Multi-document Search

**User**: "Compare the pricing in Q1 vs Q2 reports"

**LLM Tool Calls**:
```json
[
  {
    "tool": "searchKnowledgeBase",
    "parameters": { "query": "Q1 pricing strategy revenue" }
  },
  {
    "tool": "searchKnowledgeBase",
    "parameters": { "query": "Q2 pricing strategy revenue" }
  }
]
```

### Example 3: Project-Specific

**User**: "What does my technical spec say about caching?"

**LLM Tool Call**:
```json
{
  "tool": "searchKnowledgeBase",
  "parameters": {
    "query": "caching strategy implementation",
    "projectId": "user-selected-project-id"
  }
}
```

## Integration Checklist

- [ ] Tool registered in chat API
- [ ] Tool appears in LLM's available tools
- [ ] Test search with uploaded documents
- [ ] Verify LLM uses context in responses
- [ ] Check similarity threshold is appropriate
- [ ] Monitor token usage (context + query)

## Finding Where to Register

Common locations in Next.js apps:

1. **Chat API Route**: `src/app/api/chat/route.ts` or `src/app/api/chat/[...path]/route.ts`
2. **Tool Configuration**: `src/lib/ai/tools/tool-kit.ts` or similar
3. **Vercel AI SDK Setup**: Look for `streamText`, `generateText`, or `tools` configuration

Search your codebase:
```bash
grep -r "streamText\|generateText" src/
grep -r "tools:" src/
grep -r "DefaultToolName" src/
```

## Testing

### 1. Upload a Document
```bash
# Via UI or API
POST /api/projects/{projectId}/upload
# Upload a PDF with known content
```

### 2. Wait for Embeddings
```bash
# Check status
GET /api/projects/{projectId}/status

# Should show embeddedChunks > 0
```

### 3. Test Tool Directly
```bash
POST /api/knowledge-base/search
{
  "query": "test query from your document",
  "limit": 3
}

# Should return relevant chunks
```

### 4. Test in Chat
```
User: "What does my document say about [topic]?"
# LLM should call searchKnowledgeBase tool and use results
```

## Troubleshooting

### Tool Not Being Called

1. **Check tool is registered**: Log available tools in chat API
2. **Check LLM can see tool**: Some models need explicit tool descriptions
3. **Test direct API call**: Ensure `/api/knowledge-base/search` works
4. **Check permissions**: User must own the documents

### No Results Returned

1. **Check embeddings exist**: `GET /api/projects/{projectId}/status`
2. **Lower threshold**: Try `threshold: 0.5` instead of `0.7`
3. **Check query**: Make sure query matches document content
4. **Verify userId**: User must have access to documents

### Poor Results Quality

1. **Adjust chunk size**: In `src/lib/ai/rag/ingest.ts`
2. **Try different embedding model**: In project settings
3. **Increase limit**: Get more results to give LLM more context
4. **Improve query**: Be more specific in search terms

## Cost Considerations

Each tool call costs:
- **Query embedding**: ~$0.0001 per call (OpenAI small model)
- **LLM input tokens**: Returned context counts toward input tokens
- **Total**: ~$0.001-0.005 per search depending on context size

Optimize by:
- Setting appropriate `limit` (don't retrieve more than needed)
- Using `threshold` to filter low-relevance results
- Choosing efficient embedding models per project

## Next Steps

1. **Register the tool** in your chat API
2. **Test with a document** - Upload and ask questions
3. **Monitor usage** - Check if LLM uses tool appropriately
4. **Tune parameters** - Adjust limit/threshold based on results

## Support

For implementation help, see:
- `src/lib/ai/tools/knowledge-base/search-knowledge-base.ts` - Tool implementation
- `src/lib/ai/rag/search.ts` - Search logic
- `RAG_SETUP.md` - Infrastructure setup




























