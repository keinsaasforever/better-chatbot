import type { Buffer } from "node:buffer";
import type { IngestionPart } from "../parts";

/**
 * One format's extraction step, and nothing else.
 *
 * Everything a reader must not decide is decided before it runs: ownership,
 * which format this is, whether that format is switched on, how many bytes are
 * allowed, and how long the turn will wait. A reader is handed bytes and a
 * character budget and returns text. That is what makes adding a format a
 * matter of one file plus one registry line.
 */
export type ReaderInput = {
  buffer: Buffer;
  /** The attachment's display name, for text that refers to the file. */
  label: string;
  /** Characters this file may contribute, already reduced by the budget spent. */
  maxChars: number;
  /** Whether the turn's model accepts images. Only the PDF reader uses it. */
  supportsVision: boolean;
};

export type ReaderResult = {
  text: string;
  /** The extraction left something out — rows, pages, characters. */
  truncated: boolean;
  /**
   * True when this format can never be extracted whole. pptx carries text
   * only: no charts, no SmartArt, no speaker notes. The model is told, so it
   * can offer the sandbox rather than assert the deck says nothing about them.
   */
  partial?: boolean;
  /** Non-text parts, e.g. PDF pages rendered for a vision model. */
  extraParts?: IngestionPart[];
};

export type Reader = (input: ReaderInput) => Promise<ReaderResult>;
