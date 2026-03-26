import { execCommand } from "./tools.js";

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
      "pr", "create",
      "--head", branch,
      "--base", base,
      "--title", title,
      "--body", body,
    ];
    if (draft) args.push("--draft");
    for (const label of labels) {
      args.push("--label", label);
    }
    const result = await execCommand("gh", args, { cwd: repoPath });
    if (result.exitCode !== 0) {
      throw new Error(`gh pr create failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
  }

  if (host === "gitlab") {
    const args = [
      "mr", "create",
      "--source-branch", branch,
      "--target-branch", base,
      "--title", title,
      "--description", body,
      "--yes",
    ];
    if (draft) args.push("--draft");
    for (const label of labels) {
      args.push("--label", label);
    }
    const result = await execCommand("glab", args, { cwd: repoPath });
    if (result.exitCode !== 0) {
      throw new Error(`glab mr create failed: ${result.stderr || result.stdout}`);
    }
    const lines = result.stdout.trim().split("\n");
    return lines[lines.length - 1];
  }

  throw new Error(`Unsupported host: ${host}`);
}

