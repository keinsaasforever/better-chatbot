/**
 * Billing and entitlement seam.
 *
 * Every metered or entitlement-gated code path goes through this module rather
 * than importing a billing provider directly. `./impl` is the only
 * edition-specific file: the cloud edition delegates to Autumn, the community
 * edition no-ops. Keep this re-export list — and the types behind it — stable,
 * because both implementations must satisfy it.
 */
export type {
  BillingContext,
  CreatedUser,
  Feature,
  NotificationEmail,
  OrganizationInvitation,
  PasswordResetEmail,
  UsageEvent,
} from "./types";
export { CreditsExhaustedError } from "./errors";
export {
  assertCreditsAvailable,
  checkFeature,
  getBillingContext,
  onUserCreated,
  requireBillingContext,
  requireFeature,
  sendNotificationEmail,
  sendOrgInvitationEmail,
  sendPasswordResetEmail,
} from "./impl";
export { checkMeteredFeature, trackUsage } from "./metering";
