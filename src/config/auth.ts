// src/config/auth.ts — resolve GitHub credentials for Krites's OWN identity: its own GitHub App
// (KRITES_APP_* trio) or a fine-grained PAT (KRITES_GITHUB_TOKEN / GITHUB_TOKEN). Never Boule's or
// Praktor's App — an auto-merger is a higher-privilege identity and is scoped separately.
import { type AuthConfig, type GitHubAuth, decodePrivateKey } from "@kleroterion/koine";

export type { AuthConfig, GitHubAuth };

export function resolveAuth(env: NodeJS.ProcessEnv): AuthConfig {
  // Krites has its OWN GitHub App identity — it never borrows Boule's or Praktor's credentials.
  const appId = env.KRITES_APP_ID;
  const installationId = env.KRITES_APP_INSTALLATION_ID;
  const privateKey = env.KRITES_APP_PRIVATE_KEY;
  const token = env.KRITES_GITHUB_TOKEN || env.GITHUB_TOKEN;

  if (appId && installationId && privateKey) {
    return { github: { kind: "app", appId, installationId, privateKey: decodePrivateKey(privateKey) } };
  }
  if (token) return { github: { kind: "pat", token } };
  throw Object.assign(
    new Error(
      "no GitHub credentials: set the KRITES_APP_* trio (Krites's own App), or KRITES_GITHUB_TOKEN/GITHUB_TOKEN",
    ),
    { name: "UsageError" },
  );
}
