import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import type { LanguageModel } from "ai";

export type Provider = "anthropic" | "openai" | "google" | "vertex";

export interface ProviderConfig {
  provider: Provider;
  model: string;
}

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  vertex: "claude-sonnet-4-6",
};

const AVAILABLE_MODELS: Record<Provider, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3", "o4-mini"],
  google: ["gemini-2.0-flash", "gemini-2.5-pro-preview-06-05"],
  vertex: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
};

const providerFactories: Record<Provider, (model: string) => LanguageModel> = {
  anthropic: (model) => anthropic(model),
  openai: (model) => openai(model),
  google: (model) => google(model),
  vertex: (model) => {
    const project = process.env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.CLOUD_ML_REGION || "us-east5";
    if (!project) {
      throw new Error(
        "Vertex AI requires ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT to be set"
      );
    }
    const vertex = createVertexAnthropic({ project, location });
    return vertex(model);
  },
};

export function getModel(config: ProviderConfig): LanguageModel {
  const factory = providerFactories[config.provider];
  if (!factory) {
    throw new Error(`Unknown provider: ${config.provider}`);
  }
  return factory(config.model);
}

export function getDefaultConfig(): ProviderConfig {
  let rawProvider: string | undefined = process.env.UNSHIFT_PROVIDER;

  // Auto-detect Vertex AI when env vars are set and no explicit provider is configured
  if (!rawProvider && !process.env.ANTHROPIC_API_KEY &&
    (process.env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT)) {
    rawProvider = "vertex";
  }

  const providerStr = rawProvider || "anthropic";

  if (!(providerStr in DEFAULT_MODELS)) {
    throw new Error(
      `Unknown provider: ${providerStr}. Must be one of: ${Object.keys(DEFAULT_MODELS).join(", ")}`
    );
  }
  const provider = providerStr as Provider;
  const model = process.env.UNSHIFT_MODEL || DEFAULT_MODELS[provider];
  return { provider, model };
}

export function getDefaultModel(): LanguageModel {
  return getModel(getDefaultConfig());
}

export { DEFAULT_MODELS, AVAILABLE_MODELS };
