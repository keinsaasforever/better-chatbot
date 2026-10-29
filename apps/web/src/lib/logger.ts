import { createConsola, LogLevels } from "consola";
import { IS_DEV } from "./const";
import { createOtelReporter } from "./observability/consola-otel-reporter";

const logger = createConsola({
  level: IS_DEV ? LogLevels.debug : LogLevels.info,
  defaults: {
    tag: "keinsaas-navigator",
  },
});

// Mirror every log line to OpenTelemetry in addition to stdout. `addReporter`
// appends, so the default console reporter — and therefore Vercel logs — keeps
// working exactly as before.
const otelReporter = createOtelReporter();
if (otelReporter) {
  logger.addReporter(otelReporter);
}

export default logger;
