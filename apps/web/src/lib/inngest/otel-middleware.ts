import { SpanStatusCode } from "@opentelemetry/api";
import { InngestMiddleware } from "inngest";
import { appTracer, jobRuns } from "lib/observability/instruments";

/**
 * Wraps every Inngest function execution in a span and counts its outcome.
 *
 * Applied once on the client rather than per function, so background jobs added
 * later are instrumented by default. These runs happen inside the Next.js
 * process (served through `api/inngest/route.ts`), so the SDK is already
 * bootstrapped — only the business span is missing.
 *
 * Async job failures are entirely invisible today: nothing surfaces them beyond
 * an Inngest dashboard nobody watches during an incident.
 */
export const otelMiddleware = new InngestMiddleware({
  name: "OpenTelemetry",
  init() {
    return {
      onFunctionRun({ fn }) {
        // Function IDs are code-defined and bounded — safe as a dimension.
        const functionId = fn.id();
        const span = appTracer.startSpan(`job.${functionId}`);
        span.setAttribute("inngest.function.id", functionId);

        return {
          transformOutput({ result, step }) {
            if (result.error) {
              const error = result.error;
              if (error instanceof Error) span.recordException(error);
              span.setStatus({ code: SpanStatusCode.ERROR });
            }

            // `transformOutput` fires once per executed step *and* once for the
            // final function outcome; `step` is set only for the former.
            //
            // The two outcomes are counted at different levels on purpose. A
            // failing step is reported straight back to Inngest as a step
            // result, so the run never reaches a function-level rejection in
            // this process — counting failures only at the function level would
            // drop nearly every real failure. Successes are the opposite: every
            // step of a healthy run passes through here, so counting them per
            // step reports a five-step job as five successful runs.
            if (result.error) {
              jobRuns.add(1, { functionId, outcome: "failed" });
            } else if (!step) {
              jobRuns.add(1, { functionId, outcome: "success" });
            }
          },
          finished() {
            span.end();
          },
        };
      },
    };
  },
});
