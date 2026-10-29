import { pgChatRepository } from "./pg/repositories/chat-repository.pg";
import { pgUserRepository } from "./pg/repositories/user-repository.pg";
import { pgMcpRepository } from "./pg/repositories/mcp-repository.pg";
import { pgMcpMcpToolCustomizationRepository } from "./pg/repositories/mcp-tool-customization-repository.pg";
import { pgMcpServerCustomizationRepository } from "./pg/repositories/mcp-server-customization-repository.pg";
import { pgWorkflowRepository } from "./pg/repositories/workflow-repository.pg";
import { pgAgentRepository } from "./pg/repositories/agent-repository.pg";
import { pgSkillRepository } from "./pg/repositories/skill-repository.pg";
import { pgMcpOAuthRepository } from "./pg/repositories/mcp-oauth-repository.pg";
import { pgBookmarkRepository } from "./pg/repositories/bookmark-repository.pg";
import { pgChatExportRepository } from "./pg/repositories/chat-export-repository.pg";
import { pgPublishedPageRepository } from "./pg/repositories/published-page-repository.pg";
import { pgVoiceDeviceRepository } from "./pg/repositories/voice-device-repository.pg";
import { pgBrowserCredentialRepository } from "./pg/repositories/browser-credential-repository.pg";
import { pgProblemReportRepository } from "./pg/repositories/problem-report-repository.pg";
import { pgCockpitConnectionRepository } from "./pg/repositories/cockpit-connection-repository.pg";

export const chatRepository = pgChatRepository;
export const userRepository = pgUserRepository;
export const mcpRepository = pgMcpRepository;
export const mcpMcpToolCustomizationRepository =
  pgMcpMcpToolCustomizationRepository;
export const mcpServerCustomizationRepository =
  pgMcpServerCustomizationRepository;
export const mcpOAuthRepository = pgMcpOAuthRepository;

export const workflowRepository = pgWorkflowRepository;
export const agentRepository = pgAgentRepository;
export const skillRepository = pgSkillRepository;
export const bookmarkRepository = pgBookmarkRepository;
export const chatExportRepository = pgChatExportRepository;
export const publishedPageRepository = pgPublishedPageRepository;
export const voiceDeviceRepository = pgVoiceDeviceRepository;
export const browserCredentialRepository = pgBrowserCredentialRepository;
export const problemReportRepository = pgProblemReportRepository;
export const cockpitConnectionRepository = pgCockpitConnectionRepository;
