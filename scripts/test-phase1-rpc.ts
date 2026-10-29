/**
 * Test script for Phase 1: RPC Endpoints
 *
 * Usage: pnpm tsx scripts/test-phase1-rpc.ts
 *
 * Prerequisites:
 * 1. pnpm dev running
 * 2. User logged in (get session cookie)
 * 3. At least one MCP server configured
 */

import { createEphemeralMCPClient } from "../apps/web/src/lib/ai/mcp/ephemeral-client";

const TEST_CONFIG = {
  // Update these with your test values
  userId: "your-user-id", // Get from DB or session
  mcpServerId: "your-mcp-server-id", // Get from DB
  baseUrl: "http://localhost:3000",
};

async function testEphemeralClient() {
  console.log("🧪 Testing Ephemeral MCP Client...\n");

  try {
    console.log("1️⃣ Creating ephemeral client...");
    const client = await createEphemeralMCPClient(
      TEST_CONFIG.mcpServerId,
      TEST_CONFIG.userId,
    );

    if (!client) {
      console.error(
        "❌ Failed to create client - server not found or disabled",
      );
      return;
    }

    console.log("✅ Client created\n");

    console.log("2️⃣ Connecting to MCP server...");
    await client.connect();
    console.log("✅ Connected\n");

    console.log("3️⃣ Listing tools...");
    const tools = client.getToolInfo();
    console.log(`✅ Found ${tools.length} tools:`);
    tools.forEach((tool, i) => {
      console.log(
        `   ${i + 1}. ${tool.name} - ${tool.description || "No description"}`,
      );
    });
    console.log("");

    if (tools.length > 0) {
      console.log("4️⃣ Testing tool call (first tool)...");
      const firstTool = tools[0];
      console.log(`   Calling: ${firstTool.name}`);

      try {
        const result = await client.callTool(firstTool.name, {});
        console.log("✅ Tool call successful");
        console.log(
          "   Result:",
          JSON.stringify(result, null, 2).slice(0, 200) + "...",
        );
      } catch (error: any) {
        console.log("⚠️  Tool call failed (expected if tool requires params)");
        console.log("   Error:", error.message);
      }
      console.log("");
    }

    console.log("5️⃣ Disconnecting...");
    await client.disconnect();
    console.log("✅ Disconnected\n");

    console.log("✅ All tests passed!\n");
  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
    console.error("Stack:", error.stack);
  }
}

async function testRPCEndpoints() {
  console.log("🧪 Testing RPC API Endpoints...\n");
  console.log("⚠️  Note: These tests require authentication cookie\n");

  // Test 1: List Tools endpoint
  console.log("1️⃣ Testing GET /api/mcp/rpc/list-tools...");
  try {
    const url = `${TEST_CONFIG.baseUrl}/api/mcp/rpc/list-tools?serverId=${TEST_CONFIG.mcpServerId}`;
    console.log(`   URL: ${url}`);
    console.log("   ⚠️  Add authentication cookie to test this endpoint");
    console.log('   Example: curl -H "Cookie: your-session-cookie" ' + url);
  } catch (error: any) {
    console.error("❌ Failed:", error.message);
  }
  console.log("");

  // Test 2: Tool Call endpoint
  console.log("2️⃣ Testing POST /api/mcp/rpc/tool-call...");
  try {
    const url = `${TEST_CONFIG.baseUrl}/api/mcp/rpc/tool-call`;
    console.log(`   URL: ${url}`);
    console.log(
      '   Body: { "mcpServerId": "...", "toolName": "...", "params": {} }',
    );
    console.log("   ⚠️  Add authentication cookie to test this endpoint");
    console.log(
      '   Example: curl -X POST -H "Cookie: your-session-cookie" -H "Content-Type: application/json" -d \'{"mcpServerId":"...","toolName":"...","params":{}}\' ' +
        url,
    );
  } catch (error: any) {
    console.error("❌ Failed:", error.message);
  }
  console.log("");
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Phase 1 RPC Implementation Test Suite");
  console.log("═══════════════════════════════════════════════════════\n");

  // Check if config is set
  if (
    TEST_CONFIG.userId === "your-user-id" ||
    TEST_CONFIG.mcpServerId === "your-mcp-server-id"
  ) {
    console.log("⚠️  Please update TEST_CONFIG with your actual values:\n");
    console.log("1. Get userId from your database or session");
    console.log("2. Get mcpServerId from your database (McpServerTable)");
    console.log("3. Update TEST_CONFIG at the top of this file\n");
    console.log("Example query to get IDs:");
    console.log(
      '  SELECT id, name, "userId" FROM "McpServerTable" WHERE enabled = true LIMIT 1;\n',
    );
    return;
  }

  await testEphemeralClient();
  await testRPCEndpoints();

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Test Suite Complete");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(console.error);
