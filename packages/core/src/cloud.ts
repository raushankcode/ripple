import * as crypto from "crypto";
import { execSync } from "child_process";
import { RippleAuditSummary } from "./audit";
import { RippleApprovalRecord } from "./approval";
import { ChangeIntent } from "./change-intent";

// FOUNDER FIX: Inline dotenv loader from process.cwd()
import { existsSync, readFileSync } from "fs";
import { join } from "path";

function loadDotEnv(): void {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  
  try {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex < 1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim()
        .replace(/^["']/, "").replace(/["']$/, "");
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch { /* silent — never block for dotenv failures */ }
}

loadDotEnv(); // Must run before constants are evaluated

const RIPPLE_CLOUD_URL = process.env.RIPPLE_CLOUD_URL ?? "https://ripple-cloud.vercel.app";

export class RippleCloudClient {
  private apiUrl: string;
  private apiKey: string | undefined;

  constructor() {
    this.apiUrl = RIPPLE_CLOUD_URL;
    this.apiKey = process.env.RIPPLE_API_KEY;
  }

  get isConfigured(): boolean {
    return typeof this.apiKey === "string" && this.apiKey.trim().length > 0;
  }

  private getGitMetadata(commitSha?: string) {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", stdio: "pipe" }).trim();
      let actor = "unknown_actor";
      try {
        actor = commitSha
          // Double quotes, not single: on Windows (cmd.exe) single quotes are
          // not string delimiters, so 'git log --pretty=format:'%ae'' returns
          // the address wrapped in literal quotes and corrupts the audit actor.
          ? execSync(`git log -1 --pretty=format:"%ae" ${commitSha}`, { encoding: "utf8", stdio: "pipe" }).trim()
          : execSync("git config user.email", { encoding: "utf8", stdio: "pipe" }).trim();
      } catch {
        actor = execSync("git config user.email", { encoding: "utf8", stdio: "pipe" }).trim();
      }
      return { branch, actor };
    } catch {
      return { branch: "unknown", actor: "unknown" };
    }
  }

  async syncIntent(intent: ChangeIntent): Promise<void> {
    if (!this.isConfigured) return;
    try {
      await fetch(`${this.apiUrl}/api/intents`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
        body: JSON.stringify(intent)
      });
    } catch (error) {} 
  }

  async syncApproval(approval: RippleApprovalRecord): Promise<void> {
    if (!this.isConfigured) return;
    try {
      const { branch, actor } = this.getGitMetadata();
      const rawPayload = JSON.stringify(approval);
      const payloadHash = crypto.createHash("sha256").update(rawPayload).digest("hex");

      const requestBody = {
        protocol: "ripple-approval",
        intentId: approval.intentId,
        branch, actor, source: "cli", payloadHash,
        gate: approval.gate, payload: approval
      };

      await fetch(`${this.apiUrl}/api/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
        body: JSON.stringify(requestBody)
      });
    } catch (error) {}
  }

  async syncVerification(verification: any): Promise<void> {
    if (!this.isConfigured) return;
    try {
      const { branch, actor } = this.getGitMetadata();
      const rawPayload = JSON.stringify(verification);
      const payloadHash = crypto.createHash("sha256").update(rawPayload).digest("hex");

      const requestBody = {
        protocol: "ripple-verification",
        intentId: verification.intentId,
        branch, actor, source: "cli", payloadHash,
        status: verification.status, payload: verification
      };

      await fetch(`${this.apiUrl}/api/verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
        body: JSON.stringify(requestBody)
      });
    } catch (error) {}
  }

  async syncAudit(audit: RippleAuditSummary, commitSha: string): Promise<{ sent: boolean, error?: string }> {
    // FOUNDER FIX: Re-check environment variable dynamically
    const apiKey = process.env.RIPPLE_API_KEY;

    if (!apiKey) {
      if (process.env.RIPPLE_CLOUD_URL) {
        console.warn("\n[Ripple Cloud] ⚠ RIPPLE_API_KEY not found. Set it in .env or environment.");
      }
      return { sent: false };
    }

    try {
      const { branch, actor } = this.getGitMetadata(commitSha);
      const rawPayload = JSON.stringify(audit);
      const payloadHash = crypto.createHash("sha256").update(rawPayload).digest("hex");

      const requestBody = {
        protocol: "ripple-audit",
        intentId: audit.intent.id,
        commitSha: commitSha,
        branch, actor, source: "cli", payloadHash,
        decision: audit.decision, payload: audit
      };

      const response = await fetch(`${this.apiUrl}/api/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { sent: false, error: `HTTP ${response.status}: ${body}` };
      }

      return { sent: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { sent: false, error: message };
    }
  }
}
export function getCurrentCommitSha(execSync: any): string {
  // PR head SHA is the actual commit — not the synthetic merge SHA
  if (process.env.GITHUB_HEAD_SHA) return process.env.GITHUB_HEAD_SHA;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "unknown"; }
}

export function getCurrentBranch(execSync: any): string {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  try { return execSync("git branch --show-current").toString().trim() || "unknown"; } catch { return "unknown"; }
}

export function getCurrentActor(execSync: any): string {
  if (process.env.GITHUB_ACTOR) return process.env.GITHUB_ACTOR;
  try { return execSync("git config user.name").toString().trim() || execSync("git config user.email").toString().trim() || "unknown"; } catch { return "unknown"; }
}


/** Requests that the cloud mint a public share link for this audit event. */
export interface CloudSharePayload {
  /** Defaults to the safest level ("minimal") server-side when omitted. */
  redaction?: "minimal" | "paths" | "full";
  expiresInDays?: number;
}

export interface CloudShareResult {
  url: string;
  expiresAt?: string;
}

export interface CloudAuditPayload {
  protocol?: string;
  intentId: string;
  decision: string;
  commitSha: string;
  branch: string;
  actor: string;
  source: string;
  payload: any;
  /** Opt-in only. Omitted entirely unless the caller asked to publish. */
  share?: CloudSharePayload;
}

export type CloudAuditResult = {
  sent: boolean;
  error?: string;
  share?: CloudShareResult;
};

export async function syncAuditToCloud(data: CloudAuditPayload): Promise<CloudAuditResult> {
  const apiKey = process.env.RIPPLE_API_KEY;
  const apiUrl = process.env.RIPPLE_CLOUD_URL ?? "https://ripple-cloud.vercel.app";

  if (!apiKey) {
    if (process.env.RIPPLE_CLOUD_URL) {
      console.warn("\n[Ripple Cloud] ⚠ RIPPLE_API_KEY not found. Set it in .env or environment.");
    }
    return { sent: false };
  }

  try {
   const requestBody = {
      protocol: data.protocol || "ripple-audit",
      intentId: data.intentId,
      commitSha: data.commitSha,
      branch: data.branch,
      actor: data.actor,
      source: data.source,
      payloadHash: crypto.createHash("sha256").update(JSON.stringify(data.payload)).digest("hex"),
      decision: data.decision,
      payload: data.payload,
      // Only present when the caller explicitly opted into publishing. Older
      // cloud deployments ignore the field, so this stays backward compatible.
      ...(data.share ? { share: data.share } : {}),
    };

    const response = await fetch(`${apiUrl}/api/audit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { sent: false, error: `HTTP ${response.status}: ${body}` };
    }

    // The audit itself already succeeded, so a missing or unparseable body must
    // never turn into a failed sync — the share link is strictly a bonus.
    return { sent: true, share: await parseShareResult(response) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sent: false, error: message };
  }
}

async function parseShareResult(response: Response): Promise<CloudShareResult | undefined> {
  try {
    const body = await response.json() as { share?: { url?: unknown; expiresAt?: unknown } };
    const url = body?.share?.url;
    if (typeof url !== "string" || url.length === 0) {
      return undefined;
    }
    const expiresAt = body.share?.expiresAt;
    return {
      url,
      expiresAt: typeof expiresAt === "string" ? expiresAt : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Pushes a validated change intent to Ripple Cloud, making it the active boundary. */
export async function pushIntentToCloud(intent: ChangeIntent): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RIPPLE_API_KEY;
  if (!apiKey) {
    return { sent: false, error: "RIPPLE_API_KEY is not set." };
  }
  const apiUrl = process.env.RIPPLE_CLOUD_URL ?? "https://ripple-cloud.vercel.app";

  try {
    const response = await fetch(`${apiUrl}/api/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(intent),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { sent: false, error: `HTTP ${response.status}: ${body}` };
    }

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sent: false, error: message };
  }
}

/** Fetches the active intent for a project from Ripple Cloud using a commit SHA. */
export async function fetchActiveIntentForCommit(_commitSha: string): Promise<ChangeIntent | null> {
  const apiKey = process.env.RIPPLE_API_KEY;
  if (!apiKey) return null;
  const apiUrl = process.env.RIPPLE_CLOUD_URL ?? "https://ripple-cloud.vercel.app";

  try {
    // Query by project via API key — NOT by commit SHA.
    // At CI time a brand new commit has zero events in the DB yet,
    // so SHA-based lookup always returns 404 on the very first run.
    const response = await fetch(`${apiUrl}/api/intents/active`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json() as ChangeIntent;
  } catch {
    return null;
  }
}