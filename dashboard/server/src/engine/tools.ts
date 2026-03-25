import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { exec, spawn } from "node:child_process";
import { resolve, relative, normalize } from "node:path";
import { readdir } from "node:fs/promises";

function assertWithinBase(baseDir: string, targetPath: string): string {
  const resolved = resolve(baseDir, targetPath);
  const rel = relative(baseDir, resolved);
  if (rel.startsWith("..") || resolve(resolved) !== resolved && rel.startsWith("..")) {
    throw new Error(`Path traversal detected: ${targetPath} resolves outside base directory`);
  }
  const normalized = normalize(resolved);
  if (!normalized.startsWith(normalize(baseDir))) {
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
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cwd = options?.cwd
    ? options.baseDir
      ? assertWithinBase(options.baseDir, options.cwd)
      : options.cwd
    : options?.baseDir ?? process.cwd();
  const timeout = options?.timeout ?? 120_000;

  return new Promise((res) => {
    exec(command, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error
        ? typeof (error as any).status === "number"
          ? (error as any).status
          : 1
        : 0;
      res({
        stdout: typeof stdout === "string" ? stdout : stdout.toString(),
        stderr: typeof stderr === "string" ? stderr : stderr.toString(),
        exitCode,
      });
    });
  });
}

export async function listFiles(pattern: string, cwd: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, base: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(`${dir}/${entry.name}`, rel);
      } else {
        if (matchGlob(rel, pattern)) {
          results.push(rel);
        }
      }
    }
  }

  await walk(cwd, "");
  return results.sort();
}

function matchGlob(path: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regex}$`).test(path);
}

export async function grepFiles(
  pattern: string,
  path: string,
  options?: { glob?: string }
): Promise<string> {
  const args = ["--color=never", "-n", pattern, path];
  if (options?.glob) {
    args.push("--include", options.glob);
  }

  return new Promise((res) => {
    const proc = spawn("grep", ["-r", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 || code === 1) {
        res(stdout || "No matches found.");
      } else {
        res(`grep error (exit ${code}): ${stderr}`);
      }
    });
  });
}
