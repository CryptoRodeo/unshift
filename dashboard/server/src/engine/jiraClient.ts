export interface JiraIssue {
  key: string;
  summary: string;
  description: string | null;
  issueType: string;
  components: string[];
  labels: string[];
  status: string;
}

interface JiraConfig {
  baseUrl: string;
  userEmail: string;
  apiToken: string;
  authType: "basic" | "bearer";
  apiVersion: "2" | "3";
}

function getConfig(): JiraConfig {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_BASE_URL is not set");

  const apiToken = process.env.JIRA_API_TOKEN;
  if (!apiToken) throw new Error("JIRA_API_TOKEN is not set");

  const authType = (process.env.JIRA_AUTH_TYPE ?? "basic") as "basic" | "bearer";
  const userEmail = process.env.JIRA_USER_EMAIL ?? "";

  if (authType === "basic" && !userEmail) {
    throw new Error("JIRA_USER_EMAIL is required for Basic auth (Jira Cloud). Set JIRA_AUTH_TYPE=bearer for Data Center PATs.");
  }

  const apiVersion = (process.env.JIRA_API_VERSION ?? "3") as "2" | "3";

  return { baseUrl: baseUrl.replace(/\/+$/, ""), userEmail, apiToken, authType, apiVersion };
}

function authHeaders(config: JiraConfig): Record<string, string> {
  if (config.authType === "bearer") {
    return { Authorization: `Bearer ${config.apiToken}` };
  }
  const encoded = Buffer.from(`${config.userEmail}:${config.apiToken}`).toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

function apiUrl(config: JiraConfig, path: string): string {
  return `${config.baseUrl}/rest/api/${config.apiVersion}${path}`;
}

async function jiraFetch(url: string, config: JiraConfig, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(config),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jira API ${res.status} ${res.statusText}: ${body}`);
  }
  return res;
}

function extractDescription(description: unknown): string | null {
  if (!description) return null;
  if (typeof description === "string") return description;
  // ADF format (API v3) — extract text nodes
  if (typeof description === "object" && description !== null && "content" in description) {
    const texts: string[] = [];
    function walk(node: any): void {
      if (node.text) texts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    }
    walk(description);
    return texts.join("") || null;
  }
  return null;
}

function parseIssue(raw: any): JiraIssue {
  const fields = raw.fields ?? {};
  return {
    key: raw.key,
    summary: fields.summary ?? "",
    description: extractDescription(fields.description),
    issueType: fields.issuetype?.name ?? "",
    components: (fields.components ?? []).map((c: any) => c.name),
    labels: fields.labels ?? [],
    status: fields.status?.name ?? "",
  };
}

export class JiraClient {
  private config: JiraConfig;

  constructor() {
    this.config = getConfig();
  }

  async searchIssues(jql: string): Promise<JiraIssue[]> {
    const { config } = this;
    const params = new URLSearchParams({
      jql,
      fields: "key,summary,description,issuetype,components,labels,status",
    });
    const searchPath = config.apiVersion === "2" ? "/search" : "/search/jql";
    const url = apiUrl(config, `${searchPath}?${params}`);

    const res = await jiraFetch(url, config);
    const data = await res.json() as any;
    return (data.issues ?? []).map(parseIssue);
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const { config } = this;
    const params = new URLSearchParams({
      fields: "summary,description,issuetype,components,labels,status",
    });
    const url = apiUrl(config, `/issue/${encodeURIComponent(key)}?${params}`);
    const res = await jiraFetch(url, config);
    const data = await res.json() as any;
    return parseIssue(data);
  }

  async transitionIssue(key: string, transitionName: string): Promise<void> {
    const { config } = this;
    const transUrl = apiUrl(config, `/issue/${encodeURIComponent(key)}/transitions`);
    const res = await jiraFetch(transUrl, config);
    const data = await res.json() as any;

    const transition = (data.transitions ?? []).find(
      (t: any) => t.name.toLowerCase() === transitionName.toLowerCase()
    );
    if (!transition) {
      const available = (data.transitions ?? []).map((t: any) => t.name).join(", ");
      throw new Error(`Transition "${transitionName}" not found for ${key}. Available: ${available}`);
    }

    await jiraFetch(transUrl, config, {
      method: "POST",
      body: JSON.stringify({ transition: { id: transition.id } }),
    });
  }

  async addComment(key: string, body: string): Promise<void> {
    const { config } = this;
    const url = apiUrl(config, `/issue/${encodeURIComponent(key)}/comment`);

    let commentBody: unknown;
    if (config.apiVersion === "3") {
      // Atlassian Document Format
      commentBody = {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: body }],
            },
          ],
        },
      };
    } else {
      commentBody = { body };
    }

    await jiraFetch(url, config, {
      method: "POST",
      body: JSON.stringify(commentBody),
    });
  }
}
