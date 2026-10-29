import { z } from "zod";

/** Body of POST /api/projects/[id]/sources/text (pasted transcripts/notes). */
export const TextSourceSchema = z.object({
  title: z.string().trim().max(200).optional(),
  text: z.string().trim().min(20).max(200_000),
});
