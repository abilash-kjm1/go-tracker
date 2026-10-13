/**
 * Stands in for the `server-only` package under Vitest, which otherwise throws
 * on import and makes every server module untestable. Next still enforces the
 * real boundary at build time.
 */
export {};
