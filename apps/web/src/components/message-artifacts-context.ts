import type { LinkableArtifact } from "lib/code-runner/artifact-links";
import { createContext } from "react";

/**
 * Generated files of the message being rendered. Lets the markdown link and
 * image overrides turn a sandbox-style reference the model wrote
 * (`sandbox:/home/user/report.xlsx`) into the file's real download, without
 * threading props through react-markdown (same idea as
 * ./markdown-streaming-context.ts).
 */
export const MessageArtifactsContext = createContext<LinkableArtifact[]>([]);
