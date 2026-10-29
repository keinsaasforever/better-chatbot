import { describe, expect, it, vi } from "vitest";

const { insert, insertValues } = vi.hoisted(() => {
  const insertReturning = vi.fn().mockResolvedValue([{ id: "task-1" }]);
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));
  return { insert, insertValues };
});
vi.mock("@/lib/db/pg/db.pg", () => ({ pgDb: { insert } }));

import { createScheduledAgentTask } from "./create-scheduled-agent-task";

const base = {
  userId: "u-1",
  agentId: "a-1",
  name: "Voice agent",
};

describe("createScheduledAgentTask", () => {
  it("rejects an invalid LLM-generated cron before inserting", async () => {
    await expect(
      createScheduledAgentTask({
        ...base,
        cronExpression: "every blue moon",
        timezone: "Europe/Berlin",
      }),
    ).rejects.toThrow(/invalid cron/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a valid schedule with a computed nextRunAt", async () => {
    const task = await createScheduledAgentTask({
      ...base,
      cronExpression: "0 9 * * *",
      timezone: "Europe/Berlin",
    });
    expect(task).toEqual({ id: "task-1" });
    const values = (insertValues.mock.calls as any[])[0][0] as {
      nextRunAt: Date | null;
    };
    expect(values.nextRunAt).toBeInstanceOf(Date);
  });
});
