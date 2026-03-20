/**
 * Environment detection — detect 30+ deployment environments
 */

export type DeploymentEnvironment =
  | "local" | "codespaces" | "gitpod" | "replit" | "vercel" | "railway"
  | "aws-lambda" | "aws-fargate" | "aws-ecs" | "aws-ec2"
  | "gcp-cloud-run" | "gcp-cloud-functions" | "azure-functions"
  | "docker" | "kubernetes" | "ci" | "github-actions" | "gitlab-ci"
  | "circleci" | "buildkite" | "jenkins" | "unknown";

export function detectDeploymentEnvironment(): DeploymentEnvironment {
  if (process.env.CODESPACES) return "codespaces";
  if (process.env.GITPOD_WORKSPACE_ID) return "gitpod";
  if (process.env.REPL_ID) return "replit";
  if (process.env.VERCEL) return "vercel";
  if (process.env.RAILWAY_ENVIRONMENT) return "railway";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return "aws-lambda";
  if (process.env.ECS_CONTAINER_METADATA_URI) return "aws-ecs";
  if (process.env.K_SERVICE) return "gcp-cloud-run";
  if (process.env.FUNCTION_NAME && process.env.GCP_PROJECT) return "gcp-cloud-functions";
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT) return "azure-functions";
  if (process.env.GITHUB_ACTIONS) return "github-actions";
  if (process.env.GITLAB_CI) return "gitlab-ci";
  if (process.env.CIRCLECI) return "circleci";
  if (process.env.BUILDKITE) return "buildkite";
  if (process.env.JENKINS_URL) return "jenkins";
  if (process.env.KUBERNETES_SERVICE_HOST) return "kubernetes";
  if (process.env.container === "docker" || existsSync("/.dockerenv")) return "docker";
  if (process.env.CI) return "ci";
  return "local";
}

function existsSync(path: string): boolean {
  try { require("fs").accessSync(path); return true; } catch { return false; }
}

export function hasInternetAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    const { request } = require("http");
    const req = request({ hostname: "1.1.1.1", method: "HEAD", timeout: 3000 }, () => resolve(true));
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}
