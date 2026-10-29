import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";

type ComposioVercel = Composio<VercelProvider>;

// Lazy singleton — instantiated on first use so the build doesn't fail when
// COMPOSIO_API_KEY is absent (e.g. CI or local builds without credentials).
let _composio: ComposioVercel | null = null;

function getInstance(): ComposioVercel {
  if (!_composio) {
    _composio = new Composio({
      provider: new VercelProvider(),
    }) as ComposioVercel;
  }
  return _composio;
}

export const composio = new Proxy({} as ComposioVercel, {
  get(_target, prop) {
    return (getInstance() as any)[prop];
  },
});
