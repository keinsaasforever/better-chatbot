export enum AppDefaultToolkit {
  Visualization = "visualization",
  WebSearch = "webSearch",
  Http = "http",
  Code = "code",
  KnowledgeBase = "knowledgeBase",
  Document = "document",
  Tabular = "tabular",
  BrowserAutomation = "browserAutomation",
}

export enum DefaultToolName {
  CreatePieChart = "createPieChart",
  CreateBarChart = "createBarChart",
  CreateLineChart = "createLineChart",
  CreateTable = "createTable",
  WebSearch = "webSearch",
  WebContent = "webContent",
  Http = "http",
  JavascriptExecution = "mini-javascript-execution",
  PythonExecution = "python-execution",
  SearchKnowledgeBase = "searchKnowledgeBase",
  QueryProjectGraph = "queryProjectGraph",
  E2BSandbox = "e2b-sandbox",
  AnalyzeDocument = "analyze-document",
  EditDocument = "edit-document",
  CreatePdf = "create-pdf",
  CreateTabularReview = "create-tabular-review",
  BrowserAutomation = "browser-automation",
  // Plan-mode only: never registered in APP_DEFAULT_TOOL_KIT, so it stays
  // out of the tool menu (like the HITL tools).
  CreatePlan = "createPlan",
}

export const SequentialThinkingToolName = "sequential-thinking";

// Plan-mode research subagent tool (not user-selectable).
export const ResearchToolName = "research";

export const ImageToolName = "image-manager";

export const PublishPageToolName = "publish-page";
