/**
 * Seed the navigator_preferred_tools table with the initial curated tool list.
 * Run: pnpm tsx scripts/seed-preferred-tools.ts
 *
 * Safe to run multiple times — uses INSERT ... ON CONFLICT DO UPDATE.
 * The table must already exist (run the Supabase SQL migration first).
 */
import "load-env";
import { pgDb } from "lib/db/pg/db.pg";
import { NavigatorPreferredToolTable } from "lib/db/pg/schema.pg";
import { sql } from "drizzle-orm";

const tools = [
  // ── Enrichment ──────────────────────────────────────────────────────────
  {
    category: "enrichment",
    primaryTool: "FullEnrich",
    secondaryTool: "Apollo",
    taskKeywords:
      "enrich, contact enrichment, lead enrichment, company data, linkedin, b2b data, person lookup, firmographics",
    composioSlug: null,
    n8nNodeType: "n8n-nodes-base.httpRequest",
    authType: "api_key",
    notes:
      "Best B2B contact & company enrichment. Use for LinkedIn email finding, firmographic data.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: false,
    viaAutumn: false,
    docsUrl: "https://fullenrich.com/docs",
    priority: 1,
  },
  {
    category: "enrichment",
    primaryTool: "Apollo",
    secondaryTool: "Clay",
    taskKeywords:
      "email finding, email lookup, prospect, lead generation, sales prospecting, sales intelligence",
    composioSlug: "apollo",
    n8nNodeType: "n8n-nodes-base.httpRequest",
    authType: "api_key",
    notes:
      "Sales intelligence and email finding. Use when building outbound prospecting workflows.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl: "https://apolloio.github.io/apollo-api-docs/",
    priority: 2,
  },
  {
    category: "enrichment",
    primaryTool: "Clay",
    secondaryTool: null,
    taskKeywords:
      "waterfall enrichment, multi-source enrichment, clay table, data enrichment pipeline",
    composioSlug: null,
    n8nNodeType: "n8n-nodes-base.httpRequest",
    authType: "api_key",
    notes:
      "Waterfall enrichment combining 50+ data sources. Use for complex enrichment with fallback providers.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: false,
    viaAutumn: false,
    docsUrl: "https://docs.clay.com",
    priority: 3,
  },

  // ── Vector Database ──────────────────────────────────────────────────────
  {
    category: "vector_db",
    primaryTool: "Pinecone",
    secondaryTool: "Qdrant",
    taskKeywords:
      "vector database, vector store, embeddings, semantic search, similarity search, RAG, retrieval augmented generation",
    composioSlug: null,
    n8nNodeType: "n8n-nodes-base.httpRequest",
    authType: "api_key",
    notes: "Default vector store for RAG and semantic search workflows.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: true,
    inComposio: false,
    viaAutumn: false,
    docsUrl: "https://docs.pinecone.io",
    priority: 1,
  },
  {
    category: "vector_db",
    primaryTool: "Qdrant",
    secondaryTool: null,
    taskKeywords:
      "qdrant, self-hosted vector, open source vector database, on-premise vector, GDPR vector",
    composioSlug: null,
    n8nNodeType: "n8n-nodes-base.httpRequest",
    authType: "api_key",
    notes:
      "Open-source vector DB. Use when self-hosted or EU data-residency is required.",
    isHiddenGem: true,
    isSelfHostable: true,
    isEuHosted: true,
    inComposio: false,
    viaAutumn: false,
    docsUrl: "https://qdrant.tech/documentation/",
    priority: 2,
  },

  // ── Memory ───────────────────────────────────────────────────────────────
  {
    category: "memory",
    primaryTool: "Mem0",
    secondaryTool: null,
    taskKeywords:
      "memory, agent memory, persistent memory, conversation history, context storage, user preferences",
    composioSlug: null,
    n8nNodeType: "n8n-nodes-base.httpRequest",
    authType: "api_key",
    notes:
      "Managed AI memory layer. Use for agents that need to remember user context across sessions.",
    isHiddenGem: true,
    isSelfHostable: true,
    isEuHosted: false,
    inComposio: false,
    viaAutumn: false,
    docsUrl: "https://docs.mem0.ai",
    priority: 1,
  },

  // ── Web Scraping ─────────────────────────────────────────────────────────
  {
    category: "web_scraping",
    primaryTool: "Firecrawl",
    secondaryTool: "Apify",
    taskKeywords:
      "web scraping, website crawl, scrape, extract web data, html parsing, markdown extraction",
    composioSlug: "firecrawl",
    n8nNodeType: "n8n-nodes-base.httpRequest",
    authType: "oauth2",
    notes:
      "Reliable crawling and markdown extraction via Composio — no manual API key.",
    isHiddenGem: false,
    isSelfHostable: true,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl: "https://docs.firecrawl.dev",
    priority: 1,
  },
  {
    category: "web_scraping",
    primaryTool: "Apify",
    secondaryTool: null,
    taskKeywords:
      "apify, web scraping, actor, playwright scraping, large-scale crawl, amazon scraping, linkedin scraping",
    composioSlug: null,
    n8nNodeType: "n8n-nodes-base.httpRequest",
    authType: "api_key",
    notes:
      "Large-scale web scraping with pre-built actors. Use for Amazon, LinkedIn, TikTok scraping.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: false,
    viaAutumn: false,
    docsUrl: "https://docs.apify.com",
    priority: 2,
  },

  // ── AI / LLM ─────────────────────────────────────────────────────────────
  {
    category: "ai_model",
    primaryTool: "Claude (Anthropic)",
    secondaryTool: "OpenAI GPT-4o",
    taskKeywords:
      "AI, LLM, language model, claude, anthropic, reasoning, analysis, summarize, extract, structured output",
    composioSlug: null,
    n8nNodeType: "@n8n/n8n-nodes-langchain.lmChatAnthropic",
    authType: "api_key",
    notes:
      "Provided by Keinsaas via Vercel AI Gateway — do not ask users for API keys.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: false,
    viaAutumn: true,
    docsUrl: "https://docs.anthropic.com",
    priority: 1,
  },
  {
    category: "ai_model",
    primaryTool: "OpenAI GPT-4o",
    secondaryTool: "Google Gemini",
    taskKeywords:
      "openai, gpt-4, gpt4o, chat completion, vision, image analysis, openai api",
    composioSlug: null,
    n8nNodeType: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
    authType: "api_key",
    notes:
      "Provided by Keinsaas via Vercel AI Gateway — do not ask users for API keys.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: false,
    viaAutumn: true,
    docsUrl: "https://platform.openai.com/docs",
    priority: 2,
  },
  {
    category: "ai_model",
    primaryTool: "Google Gemini",
    secondaryTool: null,
    taskKeywords:
      "gemini, google ai, multimodal, google llm, vertex ai, google cloud ai",
    composioSlug: null,
    n8nNodeType: "@n8n/n8n-nodes-langchain.lmChatGoogleGemini",
    authType: "api_key",
    notes:
      "Provided by Keinsaas via Vercel AI Gateway — do not ask users for API keys.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: true,
    inComposio: false,
    viaAutumn: true,
    docsUrl: "https://ai.google.dev/docs",
    priority: 3,
  },

  // ── Email ────────────────────────────────────────────────────────────────
  {
    category: "email",
    primaryTool: "Gmail",
    secondaryTool: "SendGrid",
    taskKeywords:
      "email, gmail, send email, read email, inbox, google mail, email automation",
    composioSlug: "gmail",
    n8nNodeType: "n8n-nodes-base.gmail",
    authType: "oauth2",
    notes: "Default for personal/workspace email automation.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/",
    priority: 1,
  },
  {
    category: "email",
    primaryTool: "SendGrid",
    secondaryTool: null,
    taskKeywords:
      "sendgrid, transactional email, bulk email, marketing email, email campaign, high volume email",
    composioSlug: null,
    n8nNodeType: "n8n-nodes-base.sendGrid",
    authType: "api_key",
    notes:
      "Transactional and marketing email. Use for high-volume or template-based sending.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: false,
    viaAutumn: false,
    docsUrl: "https://docs.sendgrid.com",
    priority: 2,
  },

  // ── CRM ──────────────────────────────────────────────────────────────────
  {
    category: "crm",
    primaryTool: "HubSpot",
    secondaryTool: "Salesforce",
    taskKeywords:
      "crm, hubspot, contacts, deals, pipeline, sales crm, marketing crm, lead management",
    composioSlug: "hubspot",
    n8nNodeType: "n8n-nodes-base.hubspot",
    authType: "oauth2",
    notes:
      "Default CRM for SMB. Use for contact/deal management and sales automation.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: true,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.hubspot/",
    priority: 1,
  },
  {
    category: "crm",
    primaryTool: "Salesforce",
    secondaryTool: null,
    taskKeywords:
      "salesforce, enterprise crm, sfdc, salesforce crm, enterprise sales, salesforce object",
    composioSlug: "salesforce",
    n8nNodeType: "n8n-nodes-base.salesforce",
    authType: "oauth2",
    notes:
      "Enterprise CRM. Use when the user explicitly mentions Salesforce or enterprise scale.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: true,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.salesforce/",
    priority: 2,
  },

  // ── Spreadsheet ──────────────────────────────────────────────────────────
  {
    category: "spreadsheet",
    primaryTool: "Google Sheets",
    secondaryTool: "Airtable",
    taskKeywords:
      "google sheets, spreadsheet, sheet, google docs, table, row data, export to sheet",
    composioSlug: "googlesheets",
    n8nNodeType: "n8n-nodes-base.googleSheets",
    authType: "oauth2",
    notes:
      "Default for spreadsheet input/output. Use when user mentions 'sheet' or 'spreadsheet'.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/",
    priority: 1,
  },
  {
    category: "spreadsheet",
    primaryTool: "Airtable",
    secondaryTool: null,
    taskKeywords:
      "airtable, database, base, airtable table, airtable record, no-code database",
    composioSlug: "airtable",
    n8nNodeType: "n8n-nodes-base.airtable",
    authType: "oauth2",
    notes:
      "Structured database with spreadsheet UX. Use when user explicitly mentions Airtable.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.airtable/",
    priority: 2,
  },

  // ── Communication ────────────────────────────────────────────────────────
  {
    category: "communication",
    primaryTool: "Slack",
    secondaryTool: "Discord",
    taskKeywords:
      "slack, team chat, slack message, slack channel, team notification, alert slack, post to slack",
    composioSlug: "slack",
    n8nNodeType: "n8n-nodes-base.slack",
    authType: "oauth2",
    notes:
      "Default team messaging. Use for notifications, alerts, and approval flows.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.slack/",
    priority: 1,
  },
  {
    category: "communication",
    primaryTool: "Discord",
    secondaryTool: null,
    taskKeywords:
      "discord, discord server, discord bot, discord message, community notification",
    composioSlug: "discord",
    n8nNodeType: "n8n-nodes-base.discord",
    authType: "oauth2",
    notes: "Use for Discord communities or when user explicitly needs Discord.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.discord/",
    priority: 2,
  },

  // ── Task / Project Management ─────────────────────────────────────────────
  {
    category: "task_management",
    primaryTool: "Notion",
    secondaryTool: "Linear",
    taskKeywords:
      "notion, notion database, notion page, knowledge base, wiki, notion block",
    composioSlug: "notion",
    n8nNodeType: "n8n-nodes-base.notion",
    authType: "oauth2",
    notes: "Default for knowledge base and lightweight project tracking.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.notion/",
    priority: 1,
  },
  {
    category: "task_management",
    primaryTool: "Linear",
    secondaryTool: "Asana",
    taskKeywords:
      "linear, issue tracker, engineering tickets, bug tracking, sprint, developer tasks",
    composioSlug: "linear",
    n8nNodeType: "n8n-nodes-base.linear",
    authType: "oauth2",
    notes:
      "Engineering issue tracker. Use for dev team workflows and bug report automation.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.linear/",
    priority: 2,
  },

  // ── Storage ──────────────────────────────────────────────────────────────
  {
    category: "storage",
    primaryTool: "Google Drive",
    secondaryTool: "AWS S3",
    taskKeywords:
      "google drive, file storage, upload file, download file, gdrive, google docs file, file sharing",
    composioSlug: "googledrive",
    n8nNodeType: "n8n-nodes-base.googleDrive",
    authType: "oauth2",
    notes:
      "Default cloud file storage. Use for file uploads, downloads, and document management.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googledrive/",
    priority: 1,
  },
  {
    category: "storage",
    primaryTool: "AWS S3",
    secondaryTool: null,
    taskKeywords:
      "s3, aws s3, object storage, bucket, cloud storage, amazon s3, blob storage",
    composioSlug: null,
    n8nNodeType: "n8n-nodes-base.s3",
    authType: "api_key",
    notes:
      "Use when user mentions S3, AWS, or needs enterprise-grade object storage.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: true,
    inComposio: false,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.s3/",
    priority: 2,
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  {
    category: "payments",
    primaryTool: "Stripe",
    secondaryTool: null,
    taskKeywords:
      "stripe, payment, invoice, subscription, charge, billing, checkout, payment intent, payment webhook",
    composioSlug: "stripe",
    n8nNodeType: "n8n-nodes-base.stripe",
    authType: "api_key",
    notes:
      "Default payments. Use for invoice generation, subscription events, payment notifications.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.stripe/",
    priority: 1,
  },

  // ── E-commerce ───────────────────────────────────────────────────────────
  {
    category: "ecommerce",
    primaryTool: "Shopify",
    secondaryTool: null,
    taskKeywords:
      "shopify, ecommerce, online store, product, order, shopify webhook, shopify order, woocommerce",
    composioSlug: "shopify",
    n8nNodeType: "n8n-nodes-base.shopify",
    authType: "api_key",
    notes:
      "Default e-commerce. Use for order processing, inventory, and customer workflows.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.shopify/",
    priority: 1,
  },

  // ── Calendar ─────────────────────────────────────────────────────────────
  {
    category: "calendar",
    primaryTool: "Google Calendar",
    secondaryTool: "Calendly",
    taskKeywords:
      "calendar, meeting, event, google calendar, schedule, appointment, booking, reminder",
    composioSlug: "googlecalendar",
    n8nNodeType: "n8n-nodes-base.googleCalendar",
    authType: "oauth2",
    notes:
      "Default calendar. Use for scheduling, meeting creation, and calendar automation.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlecalendar/",
    priority: 1,
  },

  // ── DevOps ───────────────────────────────────────────────────────────────
  {
    category: "devops",
    primaryTool: "GitHub",
    secondaryTool: null,
    taskKeywords:
      "github, git, pull request, issue, repo, code repository, CI/CD, github actions, deployment",
    composioSlug: "github",
    n8nNodeType: "n8n-nodes-base.github",
    authType: "oauth2",
    notes:
      "Default source control. Use for PR automation, issue management, deployment triggers.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: true,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.github/",
    priority: 1,
  },

  // ── Webhook / HTTP ───────────────────────────────────────────────────────
  {
    category: "webhook",
    primaryTool: "n8n HTTP Request",
    secondaryTool: null,
    taskKeywords:
      "webhook, http request, api call, rest api, custom api, http trigger, generic api",
    composioSlug: null,
    n8nNodeType: "n8n-nodes-base.httpRequest",
    authType: "api_key",
    notes:
      "Generic HTTP node for custom API integrations not covered by dedicated nodes.",
    isHiddenGem: false,
    isSelfHostable: false,
    isEuHosted: false,
    inComposio: false,
    viaAutumn: false,
    docsUrl:
      "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/",
    priority: 1,
  },
];

async function seed() {
  console.log(`Seeding ${tools.length} preferred tools...`);

  for (const tool of tools) {
    await pgDb
      .insert(NavigatorPreferredToolTable)
      .values(tool)
      .onConflictDoUpdate({
        target: [
          NavigatorPreferredToolTable.category,
          NavigatorPreferredToolTable.primaryTool,
        ],
        set: {
          secondaryTool: sql`excluded.secondary_tool`,
          taskKeywords: sql`excluded.task_keywords`,
          composioSlug: sql`excluded.composio_slug`,
          n8nNodeType: sql`excluded.n8n_node_type`,
          authType: sql`excluded.auth_type`,
          notes: sql`excluded.notes`,
          isHiddenGem: sql`excluded.is_hidden_gem`,
          isSelfHostable: sql`excluded.is_self_hostable`,
          isEuHosted: sql`excluded.is_eu_hosted`,
          inComposio: sql`excluded.in_composio`,
          viaAutumn: sql`excluded.via_autumn`,
          docsUrl: sql`excluded.docs_url`,
          priority: sql`excluded.priority`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  }

  console.log("✅ Preferred tools seeded successfully.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
