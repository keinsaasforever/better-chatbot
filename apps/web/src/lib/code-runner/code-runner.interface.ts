export type LogEntry = {
  type: "log" | "error" | (string & {});
  args: ({ type: "data"; value: any } | { type: "image"; value: string })[];
};

export type E2BArtifact = {
  filename: string;
  mimeType?: string;
  url?: string;
  /** Decoded size, so the chat can show it once the bytes themselves are gone. */
  sizeBytes?: number;
  contentBase64?: string;
  /**
   * Why the file could not be delivered (too large, upload failed). The chat
   * still names it so the user knows it existed; the model can explain.
   */
  error?: string;
};

export type CodeRunnerResult = {
  success: boolean;
  logs: LogEntry[];
  error?: string;
  executionTimeMs?: number;
  result?: any;
  artifacts?: E2BArtifact[];
  sbxId?: string;
  /** Which backend actually ran the code, so the UI can label it truthfully. */
  backend?: "e2b" | "local";
  /** Attachment filenames staged into the sandbox working directory. */
  stagedFiles?: string[];
};

export type CodeRunnerOptions = {
  code: string;
  timeout?: number;
  onLog?: (entry: LogEntry) => void;
  /**
   * Thread whose attachments should be staged into the sandbox before the code
   * runs. Only used by the E2B backend; the browser worker ignores it.
   */
  threadId?: string;
  /**
   * Agent whose bound files should be staged into the sandbox alongside the
   * thread's attachments. Only used by the E2B backend; the browser worker
   * ignores it, and the server re-checks that the caller may use the agent.
   */
  agentId?: string;
};

export type CodeWorkerRequest = {
  code: string;
  type: "javascript" | "python";
  timeout?: number;
  id: string;
};

export type CodeWorkerEvent = {
  id: string;
  type: "log";
  entry: LogEntry;
};
export type CodeWorkerResult = {
  id: string;
  type: "result";
  result: CodeRunnerResult;
};

export type CodeWorkerResponse = CodeWorkerEvent | CodeWorkerResult;
