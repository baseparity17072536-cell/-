export const OWNER_STATE = "test-results/.auth/owner.json";
/** TOTP secret of the dev owner, written by auth.setup.ts on first enrollment (git-ignored).
 *  Not under test-results/, which Playwright empties before every run. */
export const OWNER_TOTP = "playwright/.auth/owner-totp.txt";
