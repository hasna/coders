/**
 * AWS Bedrock provider adapter
 *
 * API: POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke
 * Auth: AWS Signature V4 (via AWS SDK or env credentials)
 */
import type { ProviderAdapter } from "./interface.js";
import { resolveModelId } from "../models.js";

export class BedrockAdapter implements ProviderAdapter {
  readonly name = "bedrock";
  readonly baseUrl: string;
  private region: string;

  constructor(baseUrl?: string) {
    this.region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
    this.baseUrl = baseUrl
      ?? process.env.ANTHROPIC_BEDROCK_BASE_URL
      ?? `https://bedrock-runtime.${this.region}.amazonaws.com`;
  }

  buildHeaders(_apiKey: string, _isOAuth: boolean): Record<string, string> {
    // Bedrock uses AWS Signature V4, not API keys directly
    // The actual signing happens at the HTTP client level
    return {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
  }

  resolveModel(model: string): string {
    return resolveModelId(model, "bedrock");
  }

  buildRequestBody(body: Record<string, unknown>): Record<string, unknown> {
    // Bedrock wraps the request differently
    const { model, ...rest } = body;
    return {
      ...rest,
      anthropic_version: "bedrock-2023-05-31",
    };
  }

  getBetaHeaders(): string[] {
    return [];
  }

  supportsModel(model: string): boolean {
    const resolved = this.resolveModel(model);
    return resolved.includes("anthropic");
  }

  getMessagesEndpoint(): string {
    // Bedrock uses model-specific endpoints
    return "/model/{modelId}/invoke";
  }

  getTokenCountEndpoint(): string {
    return "/model/{modelId}/invoke"; // Bedrock doesn't have separate token counting
  }
}
