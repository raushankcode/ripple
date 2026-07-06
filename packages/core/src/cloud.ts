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
          ? execSync(`git log -1 --pretty=format:'%ae' ${commitSha}`, { encoding: "utf8", stdio: "pipe" }).trim()
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


export interface CloudAuditPayload {
  protocol?: string;
  intentId: string;
  decision: string;
  commitSha: string;
  branch: string;
  actor: string;
  source: string;
  payload: any;
}

export async function syncAuditToCloud(data: CloudAuditPayload): Promise<{ sent: boolean; error?: string }> {
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

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sent: false, error: message };
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
export async function fetchActiveIntentForCommit(commitSha: string): Promise<ChangeIntent | null> {
  const apiKey = process.env.RIPPLE_API_KEY;
  if (!apiKey) return null;
  const apiUrl = process.env.RIPPLE_CLOUD_URL ?? "https://ripple-cloud.vercel.app";

  try {
    const response = await fetch(`${apiUrl}/api/intents/active?commit_sha=${commitSha}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }
    
    // The response body is the raw intent payload
    return await response.json() as ChangeIntent;
  } catch {
    return null;
  }
}