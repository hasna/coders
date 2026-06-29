/**
 * Google Vertex AI provider adapter
 *
 * API: POST https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/anthropic/models/{model}:streamRawPredict
 * Auth: Google Cloud OAuth2 bearer token
 */
import type { ProviderAdapter } from "./interface.js";
import { resolveModelId } from "../models.js";

export class VertexAdapter implements ProviderAdapter {
  readonly name = "vertex";
  readonly baseUrl: string;
  private region: string;
  private projectId: string;

  constructor(baseUrl?: string) {
    this.region = process.env.CLOUD_ML_REGION ?? process.env.VERTEX_REGION ?? "us-east5";
    this.projectId = process.env.ANTHROPIC_VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
    this.baseUrl = baseUrl
      ?? process.env.ANTHROPIC_VERTEX_BASE_URL
      ?? `https://${this.region}-aiplatform.googleapis.com`;
  }

  buildHeaders(apiKey: string, _isOAuth: boolean): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
  }

  resolveModel(model: string): string {
    return resolveModelId(model, "vertex");
  }

  buildRequestBody(body: Record<string, unknown>): Record<string, unknown> {
    const { model, ...rest } = body;
    return {
      ...rest,
      anthropic_version: "vertex-2023-10-16",
    };
  }

  getBetaHeaders(): string[] {
    return [];
  }

  supportsModel(model: string): boolean {
    const resolved = this.resolveModel(model);
    return resolved.includes("claude");
  }

  getMessagesEndpoint(): string {
    return `/v1/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/{modelId}:streamRawPredict`;
  }
}
