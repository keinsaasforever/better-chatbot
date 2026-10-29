/**
 * Thrown when the billing customer has no credits left. Callers turn this into
 * a 402 so the client can surface the upgrade prompt.
 *
 * Lives outside the swapped implementation so `instanceof` keeps working in
 * both editions (the community edition simply never throws it).
 */
export class CreditsExhaustedError extends Error {
  constructor(message = "Your plan's token allowance has been used up.") {
    super(message);
    this.name = "CreditsExhaustedError";
  }
}
