import { tool, type CoreTool } from "ai";
import { z } from "zod";
import { readFile, writeFile, bash, listFiles, grepFiles } from "./tools.js";
import { JiraClient } from "./jiraClient.js";
import { createPR } from "./gitClient.js";

type ToolSet = Record<string, CoreTool>;

export function createFileTools(cwd: string): ToolSet {
  return {
    read_file: tool({
      description: "Read a file and return its contents",
      inputSchema: z.object({ path: z.string().describe("File path relative to the working directory") }),
      execute: async ({ path }) => readFile(path, cwd),
    }),
    write_file: tool({
      description: "Write content to a file, creating parent directories if needed",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the working directory"),
        content: z.string().describe("Content to write"),
      }),
      execute: async ({ path, content }) => writeFile(path, content, cwd),
    }),
    bash: tool({
      description: "Execute a shell command and return stdout, stderr, and exit code",
      inputSchema: z.object({
        command: z.string().describe("The shell command to execute"),
        cwd: z.string().optional().describe("Working directory for the command (relative to base)"),
      }),
      execute: async ({ command, cwd: cmdCwd }) =>
        bash(command, { cwd: cmdCwd, baseDir: cwd }),
    }),
    list_files: tool({
      description: "List files matching a glob pattern",
      inputSchema: z.object({
        pattern: z.string().describe("Glob pattern (e.g. **/*.ts)"),
        cwd: z.string().describe("Directory to search in"),
      }),
      execute: async ({ pattern, cwd: listCwd }) => {
        const files = await listFiles(pattern, listCwd || cwd, cwd);
        return files.join("\n");
      },
    }),
    search_files: tool({
      description: "Search file contents using grep",
      inputSchema: z.object({
        pattern: z.string().describe("Search pattern (regex)"),
        path: z.string().describe("File or directory path to search in"),
        glob: z.string().optional().describe("Glob to filter files (e.g. *.ts)"),
      }),
      execute: async ({ pattern, path, glob }) =>
        grepFiles(pattern, path, { glob, baseDir: cwd }),
    }),
  };
}

export function createJiraTools(): ToolSet {
  const jira = new JiraClient();
  return {
    jira_search: tool({
      description: "Search Jira issues using JQL",
      inputSchema: z.object({ jql: z.string().describe("JQL query string") }),
      execute: async ({ jql }) => {
        const issues = await jira.searchIssues(jql);
        return JSON.stringify(issues, null, 2);
      },
    }),
    jira_get_issue: tool({
      description: "Get a single Jira issue by key",
      inputSchema: z.object({ key: z.string().describe("Issue key (e.g. PROJ-123)") }),
      execute: async ({ key }) => {
        const issue = await jira.getIssue(key);
        return JSON.stringify(issue, null, 2);
      },
    }),
    jira_transition: tool({
      description: "Transition a Jira issue to a new status",
      inputSchema: z.object({
        key: z.string().describe("Issue key (e.g. PROJ-123)"),
        transitionName: z.string().describe("Target transition name"),
      }),
      execute: async ({ key, transitionName }) => {
        await jira.transitionIssue(key, transitionName);
        return `Transitioned ${key} via "${transitionName}"`;
      },
    }),
    jira_comment: tool({
      description: "Add a comment to a Jira issue",
      inputSchema: z.object({
        key: z.string().describe("Issue key (e.g. PROJ-123)"),
        body: z.string().describe("Comment text"),
      }),
      execute: async ({ key, body }) => {
        await jira.addComment(key, body);
        return `Added comment to ${key}`;
      },
    }),
  };
}

export function createPRTool(repoPath: string): ToolSet {
  return {
    create_pr: tool({
      description: "Create a pull/merge request",
      inputSchema: z.object({
        host: z.enum(["github", "gitlab"]).describe("Git hosting platform"),
        branch: z.string().describe("Source branch"),
        base: z.string().describe("Target/base branch"),
        title: z.string().describe("PR title"),
        body: z.string().describe("PR description"),
        draft: z.boolean().describe("Create as draft"),
        labels: z.array(z.string()).describe("Labels to apply"),
      }),
      execute: async (opts) => createPR({ ...opts, repoPath }),
    }),
  };
}

export function planningTools(cwd: string): ToolSet {
  return {
    ...createFileTools(cwd),
    ...createJiraTools(),
  };
}

export function implementationTools(cwd: string): ToolSet {
  return createFileTools(cwd);
}

export function deliveryTools(cwd: string): ToolSet {
  return {
    ...createFileTools(cwd),
    ...createJiraTools(),
    ...createPRTool(cwd),
  };
}
