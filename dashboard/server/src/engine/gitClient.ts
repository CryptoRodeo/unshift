import { bash } from "./tools.js";

/** Escape a string for safe inclusion in a single-quoted shell argument */
function shellEscape(s: string): string {
  // Replace single quotes with '"'"' (end single-quote, add escaped quote, restart single-quote)
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
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

