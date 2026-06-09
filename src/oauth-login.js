// CLI entry for the one-time OAuth login: `pnpm run oauth-login`.
// Opens the browser, completes the PKCE flow, and persists tokens under ~/.nopii.
import { loginInteractive } from "./oauth.js";

try {
  const { credPath } = await loginInteractive();
  console.log(`\n[nopii] login successful — credentials saved to ${credPath} (mode 0600).`);
  console.log("[nopii] now start the proxy with AUTH_MODE=oauth and point Claude Code at it:");
  console.log("        AUTH_MODE=oauth pnpm start");
  console.log(
    "        ANTHROPIC_BASE_URL=http://localhost:8788 ANTHROPIC_API_KEY=sk-ant-placeholder claude",
  );
  process.exit(0);
} catch (err) {
  console.error(`\n[nopii] login failed: ${err.message}`);
  process.exit(1);
}
