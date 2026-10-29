import { createContext } from "react";

/**
 * True only inside the last, still-streaming markdown block. Lets descendants
 * rendered by react-markdown (word fade, code highlighting) tell whether their
 * block is still growing without threading props through react-markdown, which
 * does not forward custom props to component overrides.
 */
export const MarkdownStreamingContext = createContext(false);
