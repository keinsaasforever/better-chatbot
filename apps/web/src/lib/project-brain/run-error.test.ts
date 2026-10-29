import { describe, expect, it } from "vitest";
import { describeRunError } from "./run-error";

class DrizzleQueryError extends Error {
  constructor(query: string, cause: unknown) {
    super(`Failed query: ${query}\nparams: a,b,c`, { cause });
    this.name = "DrizzleQueryError";
  }
}

class PostgresError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PostgresError";
  }
}

class ProjectSourceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

describe("describeRunError", () => {
  it("unwraps a Drizzle wrapper to the Postgres cause and maps the SQLSTATE", () => {
    const error = new DrizzleQueryError(
      'insert into "project_brain_page" (...) values (...)',
      new PostgresError(
        'new row for relation "project_brain_page" violates check constraint "project_brain_page_type_check"',
        "23514",
      ),
    );

    expect(describeRunError(error)).toEqual({
      code: "schema_constraint",
      message:
        'new row for relation "project_brain_page" violates check constraint "project_brain_page_type_check"',
    });
  });

  it("never returns the SQL or the parameters of a wrapper without a cause", () => {
    const error = new DrizzleQueryError("select secret from t", undefined);
    const described = describeRunError(error);

    expect(described.code).toBe("pipeline_failed");
    expect(described.message).toBe("Database query failed");
    expect(described.message).not.toContain("select");
  });

  it("keeps the code of our own error classes", () => {
    expect(
      describeRunError(
        new ProjectSourceError(
          "connection_not_active",
          "The connector rejected the request: 403",
        ),
      ),
    ).toEqual({
      code: "connection_not_active",
      message: "The connector rejected the request: 403",
    });
  });

  it("falls back to the given code and caps the message", () => {
    const described = describeRunError(
      new Error("x".repeat(1000)),
      "consolidation_failed",
    );

    expect(described.code).toBe("consolidation_failed");
    expect(described.message).toHaveLength(300);
  });

  it("copes with non-error values", () => {
    expect(describeRunError("boom")).toEqual({
      code: "pipeline_failed",
      message: "boom",
    });
    expect(describeRunError(undefined).message).toBe("Unknown error");
  });
});
