import { Tool } from "ai";
import { AppDefaultToolkit, DefaultToolName } from ".";
import { e2bSandboxTool } from "./code/e2b-sandbox-tool";
import { jsExecutionTool } from "./code/js-run-tool";
import { pythonExecutionTool } from "./code/python-run-tool";
import {
  analyzeDocumentTool,
  editDocumentTool,
} from "./document/analyze-document-tool";
import { createPdfPlaceholderTool } from "./document/create-pdf-placeholder";
import { httpFetchTool } from "./http/fetch";
import { createQueryProjectGraphTool } from "./knowledge-base/query-project-graph";
import { searchKnowledgeBase } from "./knowledge-base/search-knowledge-base";
import { createTabularReviewTool } from "./tabular/create-tabular-review-tool";
import { createBarChartTool } from "./visualization/create-bar-chart";
import { createLineChartTool } from "./visualization/create-line-chart";
import { createPieChartTool } from "./visualization/create-pie-chart";
import { createTableTool } from "./visualization/create-table";
import { exaContentsTool, exaSearchTool } from "./web/web-search";

export const APP_DEFAULT_TOOL_KIT: Record<
  AppDefaultToolkit,
  Record<string, Tool>
> = {
  [AppDefaultToolkit.Visualization]: {
    [DefaultToolName.CreatePieChart]: createPieChartTool,
    [DefaultToolName.CreateBarChart]: createBarChartTool,
    [DefaultToolName.CreateLineChart]: createLineChartTool,
    [DefaultToolName.CreateTable]: createTableTool,
  },
  [AppDefaultToolkit.WebSearch]: {
    [DefaultToolName.WebSearch]: exaSearchTool,
    [DefaultToolName.WebContent]: exaContentsTool,
  },
  [AppDefaultToolkit.Http]: {
    [DefaultToolName.Http]: httpFetchTool,
  },
  [AppDefaultToolkit.Code]: {
    [DefaultToolName.JavascriptExecution]: jsExecutionTool,
    [DefaultToolName.PythonExecution]: pythonExecutionTool,
    [DefaultToolName.E2BSandbox]: e2bSandboxTool,
    // Lives in Code, not Document: the whole Document toolkit is deferred
    // (see DEFERRED_APP_TOOLKITS), so a tool placed there is never loaded for
    // chat. Code is also where the model already looks to produce a file.
    //
    // Bound in `tool-loading.ts`, not here: it needs the request's user for
    // billing and for the storage key the PDF is written under. The
    // placeholder keeps it listed so the toolkit toggle still gates it, and
    // tool-loading drops it when the template cannot render a PDF.
    [DefaultToolName.CreatePdf]: createPdfPlaceholderTool,
  },
  [AppDefaultToolkit.KnowledgeBase]: {
    [DefaultToolName.SearchKnowledgeBase]: searchKnowledgeBase(),
    // Rebound with the user and project in `loadAppDefaultTools`.
    [DefaultToolName.QueryProjectGraph]: createQueryProjectGraphTool(""),
  },
  [AppDefaultToolkit.Document]: {
    [DefaultToolName.AnalyzeDocument]: analyzeDocumentTool,
    [DefaultToolName.EditDocument]: editDocumentTool,
  },
  [AppDefaultToolkit.Tabular]: {
    [DefaultToolName.CreateTabularReview]: createTabularReviewTool,
  },
  // Bound in `app/api/chat/route.ts`, not here: the browser tool drives an
  // inner agent and so needs the request's resolved model, which this static
  // map has no access to. The empty entry keeps the toolkit in the tool menu
  // (`getUserConfigurableAppToolkits`) so the toggle still gates it.
  [AppDefaultToolkit.BrowserAutomation]: {},
};
