import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { exec, execFile, spawn } from "node:child_process";
import { resolve, normalize } from "node:path";
import { readdir } from "node:fs/promises";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function toExecResult(error: { code?: string | number | null } | null, stdout: string | Buffer, stderr: string | Buffer): ExecResult {
  return {
    stdout: typeof stdout === "string" ? stdout : stdout.toString(),
    stderr: typeof stderr === "string" ? stderr : stderr.toString(),
    exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
  };
}

function assertWithinBase(baseDir: string, targetPath: string): string {
  const resolved = resolve(baseDir, targetPath);
  const normalized = normalize(resolved);
  if (!normalized.startsWith(normalize(baseDir) + "/") && normalized !== normalize(baseDir)) {
    throw new Error(`Path traversal detected: ${targetPath} resolves outside base directory`);
  }
  return resolved;
}

export async function readFile(path: string, baseDir: string): Promise<string> {
  const resolved = assertWithinBase(baseDir, path);
  return fsReadFile(resolved, "utf-8");
}

export async function writeFile(path: string, content: string, baseDir: string): Promise<string> {
  const resolved = assertWithinBase(baseDir, path);
  await mkdir(resolve(resolved, ".."), { recursive: true });
  await fsWriteFile(resolved, content, "utf-8");
  return `Wrote ${content.length} bytes to ${path}`;
}

export async function bash(
  command: string,
  options?: { cwd?: string; timeout?: number; baseDir?: string }
): Promise<ExecResult> {
  let cwd: string;
  if (options?.cwd && options.baseDir) {
    cwd = assertWithinBase(options.baseDir, options.cwd);
  } else if (options?.cwd) {
    cwd = options.cwd;
  } else {
    cwd = options?.baseDir ?? process.cwd();
  }
  const timeout = options?.timeout ?? 120_000;

  return new Promise((res) => {
    exec(command, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      res(toExecResult(error, stdout, stderr));
    });
  });
}

/**
 * Execute a command with an argument array — no shell involved.
 * Use this for internal programmatic calls where arguments come from config
 * or user input. Unlike bash(), this avoids command injection by design.
 */
export async function execCommand(
  executable: string,
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<ExecResult> {
  const cwd = options?.cwd ?? process.cwd();
  const timeout = options?.timeout ?? 120_000;

  return new Promise((res) => {
    execFile(executable, args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      res(toExecResult(error, stdout, stderr));
    });
  });
}

export async function listFiles(pattern: string, cwd: string, baseDir?: string): Promise<string[]> {
  const resolvedCwd = baseDir ? assertWithinBase(baseDir, cwd) : cwd;
  const results: string[] = [];
  const regex = compileGlob(pattern);

  async function walk(dir: string, base: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(`${dir}/${entry.name}`, rel);
      } else {
        if (regex.test(rel)) {
          results.push(rel);
        }
      }
    }
  }

  await walk(resolvedCwd, "");
  return results.sort();
}

function compileGlob(pattern: string): RegExp {
  // Expand brace expressions like {ts,tsx} before escaping
  const expanded = expandBraces(pattern);
  const alts = expanded.map((p) => {
    const src = p
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "{{GLOBSTAR}}")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\{\{GLOBSTAR\}\}/g, ".*");
    return src;
  });
  return new RegExp(`^(?:${alts.join("|")})$`);
}

/** Simple single-level brace expansion: "*.{ts,tsx}" → ["*.ts", "*.tsx"] */
function expandBraces(pattern: string): string[] {
  const match = pattern.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!match) return [pattern];
  const [, prefix, alternatives, suffix] = match;
  return alternatives.split(",").map((alt) => `${prefix}${alt}${suffix}`);
}

export async function grepFiles(
  pattern: string,
  path: string,
  options?: { glob?: string; baseDir?: string; timeout?: number }
): Promise<string> {
  const resolvedPath = options?.baseDir ? assertWithinBase(options.baseDir, path) : path;
  const args = ["-r", "--color=never", "-n"];
  if (options?.glob) {
    args.push("--include", options.glob);
  }
  args.push("--", pattern, resolvedPath);

  const timeout = options?.timeout ?? 120_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);

  return new Promise((resolve, reject) => {
    const proc = spawn("grep", args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal: ac.signal,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        reject(new Error(`grep timed out after ${timeout}ms`));
      } else {
        reject(new Error(`grep spawn failed: ${err.message}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        reject(new Error(`grep timed out after ${timeout}ms`));
      } else {
        reject(new Error(`grep spawn failed: ${err.message}`));
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || code === 1) {
        resolve(stdout || "No matches found.");
      } else {
        reject(new Error(`grep failed (exit ${code}): ${stderr}`));
      }
    });
  });
}
