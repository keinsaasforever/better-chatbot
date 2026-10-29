import "server-only";

// Re-export everything from auth-instance
export { auth, getSession, getIsFirstUser } from "./auth-instance";

// Alias for Autumn integration - same as getSession but explicit name
export { getSession as getSessionWithoutRedirect } from "./auth-instance";
