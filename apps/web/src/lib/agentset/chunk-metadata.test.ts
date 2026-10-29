import { describe, expect, it } from "vitest";
import { readChunkPageNumber, resolveChunkDocumentIds } from "./chunk-metadata";

describe("resolveChunkDocumentIds", () => {
  it("prefers navigatorDocumentId over Agentset CUID documentId", () => {
    expect(
      resolveChunkDocumentIds({
        navigatorDocumentId: "b38f0af9-e6ef-4146-ad71-35276a983860",
        documentId: "cmpeb704x00000idvjowsujrz",
      }),
    ).toEqual({
      navigatorDocumentId: "b38f0af9-e6ef-4146-ad71-35276a983860",
      agentsetDocumentId: "cmpeb704x00000idvjowsujrz",
    });
  });

  it("treats UUID documentId as navigator id", () => {
    expect(
      resolveChunkDocumentIds({
        documentId: "b38f0af9-e6ef-4146-ad71-35276a983860",
      }),
    ).toEqual({
      navigatorDocumentId: "b38f0af9-e6ef-4146-ad71-35276a983860",
      agentsetDocumentId: undefined,
    });
  });

  it("treats non-UUID documentId as Agentset id", () => {
    expect(
      resolveChunkDocumentIds({
        documentId: "cmpeb704x00000idvjowsujrz",
      }),
    ).toEqual({
      navigatorDocumentId: undefined,
      agentsetDocumentId: "cmpeb704x00000idvjowsujrz",
    });
  });
});

describe("readChunkPageNumber", () => {
  it("reads page_number from metadata", () => {
    expect(readChunkPageNumber({ page_number: 3 })).toBe(3);
  });
});
