import { execFileSync } from "child_process";

type GitStdio =
  | ["ignore", "pipe", "pipe"]
  | ["ignore", "pipe", "ignore"];

type GitSpawnError = Error & {
  code?: string;
  stderr?: Buffer | string;
  stdout?: Buffer | string;
  status?: number | null;
};

export function gitReadOnlyEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
  };
}

export function execGit(
  workspaceRoot: string,
  args: string[],
  stdio: GitStdio = ["ignore", "pipe", "pipe"]
): string {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio,
      env: gitReadOnlyEnv(),
    });
  } catch (err) {
    throw new Error(formatGitError(err, args));
  }
}

export function formatGitError(err: unknown, args: string[]): string {
  const error = err as GitSpawnError;
  const code = typeof error.code === "string" ? error.code : "";
  const stderr = bufferText(error.stderr);
  const stdout = bufferText(error.stdout);
  const raw = [stderr, stdout, error.message]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  const command = `git ${args.join(" ")}`;

  if (code === "ENOENT") {
    return `Git executable was not found while running "${command}". Install Git and make sure it is available on PATH.`;
  }

  if (code === "EACCES" || code === "EPERM") {
    return `Git could not be started from this process while running "${command}" (${code}). Your OS, security software, editor sandbox, or automation environment may be blocking Node.js from launching git. Run Ripple from a normal terminal or allow Node.js to execute git.`;
  }

  if (/not a git repository/i.test(raw)) {
    return `Not inside a git worktree while running "${command}". Run Ripple from a repository root or initialize git first.`;
  }

  if (raw) {
    return `Git command failed while running "${command}": ${raw}`;
  }

  return `Git command failed while running "${command}".`;
}

function bufferText(value: Buffer | string | undefined): string {
  if (!value) {
    return "";
  }
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}
