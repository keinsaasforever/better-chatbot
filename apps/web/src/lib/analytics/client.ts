/**
 * Community build: no analytics backend.
 *
 * `./posthog.ts` keeps the typed event surface so callers are unchanged; every
 * event reported here is discarded and nothing leaves the instance.
 */

export function capture(_event: string, _properties?: object): void {}

export function identify(_userId: string, _properties?: object): void {}

export function reset(): void {}
