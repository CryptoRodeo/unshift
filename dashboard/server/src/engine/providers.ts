import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type Provider = "anthropic" | "openai" | "google";

export interface ProviderConfig {
  provider: Provider;
  model: string;
}

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
};

const providerFactories: Record<Provider, (model: string) => LanguageModel> = {
  anthropic: (model) => anthropic(model),
  openai: (model) => openai(model),
  google: (model) => google(model),
};

export function getModel(config: ProviderConfig): LanguageModel {
  const factory = providerFactories[config.provider];
  if (!factory) {
    throw new Error(`Unknown provider: ${config.provider}`);
  }
  return factory(config.model);
}

export function getDefaultConfig(): ProviderConfig {
  const provider = (process.env.UNSHIFT_PROVIDER || "anthropic") as Provider;
  if (!DEFAULT_MODELS[provider]) {
    throw new Error(
      `Unknown provider: ${provider}. Must be one of: ${Object.keys(DEFAULT_MODELS).join(", ")}`
    );
  }
  const model = process.env.UNSHIFT_MODEL || DEFAULT_MODELS[provider];
  return { provider, model };
}

export function getDefaultModel(): LanguageModel {
  return getModel(getDefaultConfig());
}

export { DEFAULT_MODELS };
