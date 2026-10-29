import { Inngest } from "inngest";
import { otelMiddleware } from "./otel-middleware";

export const inngest = new Inngest({
  id: "navigator",
  middleware: [otelMiddleware],
});
