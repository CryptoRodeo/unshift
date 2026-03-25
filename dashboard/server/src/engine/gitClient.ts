import { bash } from "./tools.js";

/** Escape a string for safe inclusion in a single-quoted shell argument */
function shellEscape(s: string): string {
  // Replace single quotes with '"'"' (end single-quote, add escaped quote, restart single-quote)
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}

async function git(repoPath: string, args: string): Promise<string> {
  const result = await bash(`git ${args}`, { cwd: repoPath });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.split(" ")[0]} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

export async function gitCheckout(repoPath: string, branch: string): Promise<void> {
  await git(repoPath, `checkout ${shellEscape(branch)}`);
}

export async function gitCreateBranch(repoPath: string, branch: string): Promise<void> {
  await git(repoPath, `checkout -b ${shellEscape(branch)}`);
}

export async function gitPull(repoPath: string): Promise<void> {
  await git(repoPath, "pull");
}

export async function gitStashIfDirty(repoPath: string, message: string): Promise<boolean> {
  const result = await bash("git status --porcelain", { cwd: repoPath });
  if (result.exitCode !== 0) {
    throw new Error(`git status failed: ${result.stderr}`);
  }
  if (!result.stdout.trim()) {
    return false;
  }
  await git(repoPath, `stash push -m ${shellEscape(message)}`);
  return true;
}

export async function gitAddAndCommit(
  repoPath: string,
  message: string,
  excludePatterns: string[]
): Promise<string> {
  // Stage all changes
  await git(repoPath, "add -A");

  // Unstage excluded patterns
  for (const pattern of excludePatterns) {
    await bash(`git reset HEAD -- ${shellEscape(pattern)}`, { cwd: repoPath });
  }

  await git(repoPath, `commit -m ${shellEscape(message)}`);

  // Return the commit hash
  return git(repoPath, "rev-parse HEAD");
}

export async function gitPush(repoPath: string, branch: string): Promise<void> {
  await git(repoPath, `push origin ${shellEscape(branch)}`);
}

interface CreatePROptions {
  host: "github" | "gitlab";
  branch: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  labels: string[];
  repoPath: string;
}

export async function createPR(opts: CreatePROptions): Promise<string> {
  const { host, branch, base, title, body, draft, labels, repoPath } = opts;

  if (host === "github") {
    const args = [
      "gh", "pr", "create",
      "--head", shellEscape(branch),
      "--base", shellEscape(base),
      "--title", shellEscape(title),
      "--body", shellEscape(body),
    ];
    if (draft) args.push("--draft");
    for (const label of labels) {
      args.push("--label", shellEscape(label));
    }
    const result = await bash(args.join(" "), { cwd: repoPath });
    if (result.exitCode !== 0) {
      throw new Error(`gh pr create failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
  }

  if (host === "gitlab") {
    const args = [
      "glab", "mr", "create",
      "--source-branch", shellEscape(branch),
      "--target-branch", shellEscape(base),
      "--title", shellEscape(title),
      "--description", shellEscape(body),
      "--yes",
    ];
    if (draft) args.push("--draft");
    for (const label of labels) {
      args.push("--label", shellEscape(label));
    }
    const result = await bash(args.join(" "), { cwd: repoPath });
    if (result.exitCode !== 0) {
      throw new Error(`glab mr create failed: ${result.stderr || result.stdout}`);
    }
    // glab outputs the MR URL
    const lines = result.stdout.trim().split("\n");
    return lines[lines.length - 1];
  }

  throw new Error(`Unsupported host: ${host}`);
}

interface AddPRCommentOptions {
  host: "github" | "gitlab";
  branch: string;
  body: string;
  repoPath: string;
}

export async function addPRComment(opts: AddPRCommentOptions): Promise<void> {
  const { host, branch, body, repoPath } = opts;

  if (host === "github") {
    const result = await bash(
      `gh pr comment ${shellEscape(branch)} --body ${shellEscape(body)}`,
      { cwd: repoPath }
    );
    if (result.exitCode !== 0) {
      throw new Error(`gh pr comment failed: ${result.stderr || result.stdout}`);
    }
    return;
  }

  if (host === "gitlab") {
    // Find MR by source branch, then comment
    const findResult = await bash(
      `glab mr list --source-branch ${shellEscape(branch)} --json url | head -1`,
      { cwd: repoPath }
    );
    if (findResult.exitCode !== 0 || !findResult.stdout.trim()) {
      throw new Error(`Could not find MR for branch ${branch}: ${findResult.stderr}`);
    }
    const result = await bash(
      `glab mr comment ${shellEscape(branch)} --message ${shellEscape(body)}`,
      { cwd: repoPath }
    );
    if (result.exitCode !== 0) {
      throw new Error(`glab mr comment failed: ${result.stderr || result.stdout}`);
    }
    return;
  }

  throw new Error(`Unsupported host: ${host}`);
}
