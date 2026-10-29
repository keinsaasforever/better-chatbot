import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { ProjectBrainExtractionSchema } from "./extraction-schema";

const meetingEntity = {
  id: "meeting-apr-7",
  type: "meeting",
  title: "April 7 Standup",
  aliases: [],
  facts: [],
  metadata: {},
};

const personEntity = {
  id: "person-alice",
  type: "person",
  title: "Alice",
  aliases: [],
  facts: [],
  metadata: {},
};

const meetingToPerson = {
  fromEntityId: "meeting-apr-7",
  toEntityId: "person-alice",
  type: "attended-by",
  confidence: 0.9,
};

/** The schema defaults every field, so only the parts under test need spelling out. */
function parse(input: Record<string, unknown>) {
  return ProjectBrainExtractionSchema.parse(input);
}

describe("ProjectBrainExtractionSchema", () => {
  it("parses a fully valid extraction unchanged", () => {
    const result = parse({
      summary: "test",
      entities: [meetingEntity, personEntity],
      relations: [meetingToPerson],
      todos: [
        {
          title: "Send the deck",
          status: "open",
          priority: "high",
          dueAt: "2026-09-10T12:00:00.000Z",
          sourceUrl: "https://todoist.com/app/task/123",
        },
      ],
    });

    expect(result.entities).toHaveLength(2);
    expect(result.relations).toHaveLength(1);
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0].sourceUrl).toBe("https://todoist.com/app/task/123");
  });

  it("returns empty defaults for a bare object", () => {
    const result = parse({});

    expect(result.entities).toEqual([]);
    expect(result.relations).toEqual([]);
    expect(result.timeline).toEqual([]);
    expect(result.todos).toEqual([]);
    expect(result.status.health).toBe("unknown");
  });

  it("does not accept the retired widgets field", () => {
    const result = parse({
      widgets: [{ kind: "table", slot: "agenda", title: "x" }],
    });

    expect("widgets" in result).toBe(false);
  });
});

describe("ProjectBrainExtractionSchema — todo resilience", () => {
  it("drops todos without a title and keeps the rest", () => {
    const result = parse({
      todos: [
        { status: "open", priority: "high" },
        { title: "Valid", status: "open", priority: "low" },
      ],
    });

    expect(result.todos).toHaveLength(1);
    expect(result.todos[0].title).toBe("Valid");
  });

  it("falls back to open/normal for unknown status or priority", () => {
    const result = parse({
      todos: [{ title: "Odd", status: "someday", priority: "urgent" }],
    });

    expect(result.todos[0]).toMatchObject({
      status: "open",
      priority: "normal",
    });
  });

  it("drops a todo whose sourceUrl is not a URL", () => {
    const result = parse({
      todos: [{ title: "Bad link", sourceUrl: "not a url" }],
    });

    expect(result.todos).toHaveLength(0);
  });
});

describe("ProjectBrainExtractionSchema — entity and relation resilience", () => {
  it("drops entities whose id breaks the id format", () => {
    const result = parse({
      entities: [{ ...meetingEntity, id: "NotSnakeCase" }, personEntity],
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].id).toBe("person-alice");
  });

  // persist-extraction.ts maps entity.id -> pageId with last-write-wins, so a
  // duplicate id would silently re-point relations at the wrong page.
  it("keeps the first entity when an id is duplicated", () => {
    const result = parse({
      entities: [
        meetingEntity,
        { ...meetingEntity, title: "Impostor Standup" },
        personEntity,
      ],
      relations: [meetingToPerson],
    });

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].title).toBe("April 7 Standup");
    // The surviving relation still resolves against the kept entity.
    expect(result.relations).toHaveLength(1);
  });

  it("drops relations that reference an entity the model never emitted", () => {
    const result = parse({
      entities: [meetingEntity],
      relations: [meetingToPerson],
    });

    expect(result.relations).toHaveLength(0);
  });

  it("normalises relation types onto the edge vocabulary", () => {
    const result = parse({
      entities: [meetingEntity, personEntity],
      relations: [meetingToPerson, { ...meetingToPerson, type: "sings_with" }],
    });

    // "attended-by" is a synonym; the unknown type collapses to related_to.
    expect(result.relations.map((relation) => relation.type)).toEqual([
      "attended",
      "related_to",
    ]);
  });

  it("drops self-referential relations", () => {
    const result = parse({
      entities: [meetingEntity],
      relations: [
        {
          fromEntityId: "meeting-apr-7",
          toEntityId: "meeting-apr-7",
          type: "self-ref",
          confidence: 1,
        },
      ],
    });

    expect(result.relations).toHaveLength(0);
  });

  it("drops timeline items with a malformed entity id", () => {
    const result = parse({
      entities: [meetingEntity],
      timeline: [
        { entityId: "NotSnakeCase", summary: "bad entity id" },
        { summary: "no entity id at all" },
        { entityId: "meeting-apr-7", summary: "valid" },
      ],
    });

    expect(result.timeline).toHaveLength(2);
  });
});

// The resilient arrays are built with z.preprocess, which in zod v4 is a
// ZodPipe(ZodTransform, inner). If the AI SDK ever rendered the *input* side of
// that pipe, the item shapes would collapse to `{}` and the model would lose
// the only description of what a todo or entity looks like. Assert through the
// same conversion generateObject performs.
describe("JSON Schema handed to the model", () => {
  const json = JSON.stringify(
    zodSchema(ProjectBrainExtractionSchema).jsonSchema,
  );

  it("describes the todo and status shapes", () => {
    expect(json).toContain('"todos"');
    expect(json).toContain('"sourceUrl"');
    expect(json).toContain('"dueAt"');
    expect(json).toContain('"health"');
  });

  it("describes the entity and relation shapes", () => {
    expect(json).toContain('"entities"');
    expect(json).toContain('"relations"');
    expect(json).toContain('"fromEntityId"');
  });

  it("no longer describes widgets", () => {
    expect(json).not.toContain('"widgets"');
  });
});
