const assert = require("assert");

const { formatGitError } = require("../dist/git");

function gitError(code, message, stderr) {
  const err = new Error(message);
  err.code = code;
  if (stderr) {
    err.stderr = Buffer.from(stderr);
  }
  return err;
}

function main() {
  const permission = formatGitError(
    gitError("EPERM", "spawnSync git EPERM"),
    ["rev-parse", "--is-inside-work-tree"]
  );
  assert(
    permission.includes("Git could not be started from this process"),
    "permission failures should explain that git could not be launched"
  );
  assert(
    permission.includes("allow Node.js to execute git"),
    "permission failures should tell the user how to fix blocked git spawning"
  );

  const missing = formatGitError(
    gitError("ENOENT", "spawnSync git ENOENT"),
    ["diff", "--cached"]
  );
  assert(
    missing.includes("Git executable was not found"),
    "missing git should be reported as a PATH/install problem"
  );

  const notRepo = formatGitError(
    gitError(undefined, "git failed", "fatal: not a git repository"),
    ["diff", "--cached"]
  );
  assert(
    notRepo.includes("Not inside a git worktree"),
    "non-repo failures should stay distinct from git spawn failures"
  );

  console.log("Ripple git error tests passed");
}

main();
