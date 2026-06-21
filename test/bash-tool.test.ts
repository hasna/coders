import { describe, it, expect } from "vitest";
import { bashTool, isReadOnlyCommand } from "../src/tools/builtin/bash.js";

describe("bash tool", () => {
  it("has correct name", () => {
    expect(bashTool.name).toBe("Bash");
  });

  it("is not read-only", () => {
    expect(bashTool.isReadOnly()).toBe(false);
  });

  it("is not concurrency-safe", () => {
    expect(bashTool.isConcurrencySafe()).toBe(false);
  });

  it("validates empty command", async () => {
    const result = await bashTool.validateInput({ command: "" });
    expect(result.result).toBe(false);
  });

  it("validates excessive timeout", async () => {
    const result = await bashTool.validateInput({ command: "ls", timeout: 999_999_999 });
    expect(result.result).toBe(false);
  });

  it("validates good command", async () => {
    const result = await bashTool.validateInput({ command: "echo hello" });
    expect(result.result).toBe(true);
  });

  it("auto-allows non-sensitive package manager config reads", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.checkPermissions({ command: "npm config get registry" }, ctx);
    expect(result.behavior).toBe("allow");
  });

  it("does not auto-allow package manager credential reads", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.checkPermissions({ command: "npm config get //registry.npmjs.org/:_authToken" }, ctx);
    expect(result.behavior).toBe("passthrough");
  });

  it("does not auto-allow package manager credential reads via shell expansion", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.checkPermissions({ command: "npm config get _au${x:-th}To${y:-k}en" }, ctx);
    expect(result.behavior).toBe("passthrough");
  });

  it("does not auto-allow package manager credential reads via brace expansion", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.checkPermissions({ command: "npm config get _au{th,}To{ken,}" }, ctx);
    expect(result.behavior).toBe("passthrough");
  });

  it("executes simple command", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.call({ command: "echo hello_world" }, ctx);
    expect(result.data.stdout.trim()).toBe("hello_world");
    expect(result.data.exitCode).toBe(0);
    expect(result.data.interrupted).toBe(false);
  });

  it("captures stderr", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.call({ command: "echo err >&2" }, ctx);
    expect(result.data.stderr.trim()).toBe("err");
  });

  it("returns non-zero exit code", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.call({ command: "exit 42" }, ctx);
    expect(result.data.exitCode).toBe(42);
  });

  it("maps result to API format", () => {
    const block = bashTool.mapToolResultToToolResultBlockParam(
      { stdout: "hello", stderr: "", exitCode: 0, interrupted: false, durationMs: 100 },
      "tool-123",
    );
    expect(block.tool_use_id).toBe("tool-123");
    expect(block.content).toBe("hello");
    expect(block.is_error).toBe(false);
  });

  it("maps error result with exit code", () => {
    const block = bashTool.mapToolResultToToolResultBlockParam(
      { stdout: "", stderr: "not found", exitCode: 1, interrupted: false, durationMs: 50 },
      "tool-456",
    );
    expect(block.is_error).toBe(true);
    expect(block.content).toContain("not found");
    expect(block.content).toContain("Exit code: 1");
  });
});

describe("isReadOnlyCommand", () => {
  // Basic read-only commands
  it("detects ls as read-only", () => expect(isReadOnlyCommand("ls")).toBe(true));
  it("detects ls -la as read-only", () => expect(isReadOnlyCommand("ls -la")).toBe(true));
  it("detects cat file as read-only", () => expect(isReadOnlyCommand("cat foo.txt")).toBe(true));
  it("detects grep as read-only", () => expect(isReadOnlyCommand("grep -r pattern .")).toBe(true));
  it("detects find as read-only", () => expect(isReadOnlyCommand("find . -name '*.ts'")).toBe(true));
  it("detects wc as read-only", () => expect(isReadOnlyCommand("wc -l file.txt")).toBe(true));
  it("detects tree as read-only", () => expect(isReadOnlyCommand("tree src/")).toBe(true));
  it("detects ps as read-only", () => expect(isReadOnlyCommand("ps aux")).toBe(true));
  it("detects date as read-only", () => expect(isReadOnlyCommand("date")).toBe(true));
  it("detects pwd as read-only", () => expect(isReadOnlyCommand("pwd")).toBe(true));

  // Git read-only
  it("detects git status as read-only", () => expect(isReadOnlyCommand("git status")).toBe(true));
  it("detects git diff as read-only", () => expect(isReadOnlyCommand("git diff")).toBe(true));
  it("detects git log as read-only", () => expect(isReadOnlyCommand("git log --oneline -5")).toBe(true));
  it("detects git show as read-only", () => expect(isReadOnlyCommand("git show HEAD")).toBe(true));

  // Git write — NOT read-only
  it("detects git commit as NOT read-only", () => expect(isReadOnlyCommand("git commit -m 'test'")).toBe(false));
  it("detects git push as NOT read-only", () => expect(isReadOnlyCommand("git push")).toBe(false));
  it("detects git checkout as NOT read-only", () => expect(isReadOnlyCommand("git checkout main")).toBe(false));

  // npm read-only
  it("detects npm ls as read-only", () => expect(isReadOnlyCommand("npm ls")).toBe(true));
  it("detects npm info as read-only", () => expect(isReadOnlyCommand("npm info react")).toBe(true));
  it("detects npm config get as read-only", () => expect(isReadOnlyCommand("npm config get registry")).toBe(true));
  it("detects npm install as NOT read-only", () => expect(isReadOnlyCommand("npm install")).toBe(false));
  it("detects npm config get auth token as NOT read-only", () => expect(isReadOnlyCommand("npm config get //registry.npmjs.org/:_authToken")).toBe(false));
  it("detects npm config get secret key as NOT read-only", () => expect(isReadOnlyCommand("npm config get _authToken")).toBe(false));
  it("detects npm config get shell-expanded secret key as NOT read-only", () => expect(isReadOnlyCommand("npm config get _au${x:-th}To${y:-k}en")).toBe(false));
  it("detects npm config get brace-expanded secret key as NOT read-only", () => expect(isReadOnlyCommand("npm config get _au{th,}To{ken,}")).toBe(false));
  it("detects npm config get glob-expanded secret key as NOT read-only", () => expect(isReadOnlyCommand("npm config get _auth*")).toBe(false));
  it("detects yarn config get auth token as NOT read-only", () => expect(isReadOnlyCommand("yarn config get npmAuthToken")).toBe(false));
  it("detects pnpm config get auth token as NOT read-only", () => expect(isReadOnlyCommand("pnpm config get //registry.npmjs.org/:_authToken")).toBe(false));
  it("detects npm config list as NOT read-only", () => expect(isReadOnlyCommand("npm config list --json")).toBe(false));
  it("detects npm config set as NOT read-only", () => expect(isReadOnlyCommand("npm config set registry https://example.invalid")).toBe(false));
  it("detects npm config delete as NOT read-only", () => expect(isReadOnlyCommand("npm config delete registry")).toBe(false));
  it("detects npm config edit as NOT read-only", () => expect(isReadOnlyCommand("npm config edit")).toBe(false));
  it("detects npm token list as NOT read-only", () => expect(isReadOnlyCommand("npm token list")).toBe(false));
  it("detects npm token revoke as NOT read-only", () => expect(isReadOnlyCommand("npm token revoke token-id")).toBe(false));
  it("detects yarn config set as NOT read-only", () => expect(isReadOnlyCommand("yarn config set npmRegistryServer https://example.invalid")).toBe(false));
  it("detects pnpm config delete as NOT read-only", () => expect(isReadOnlyCommand("pnpm config delete registry")).toBe(false));

  // curl mutating/output flags
  it("detects plain curl as NOT read-only", () => expect(isReadOnlyCommand("curl https://example.invalid")).toBe(false));
  it("detects env-wrapped curl as NOT read-only", () => expect(isReadOnlyCommand("env curl https://example.invalid")).toBe(false));
  it("detects command-wrapped curl as NOT read-only", () => expect(isReadOnlyCommand("command curl https://example.invalid")).toBe(false));
  it("detects curl -o joined output as NOT read-only", () => expect(isReadOnlyCommand("curl -o/tmp/out file:///etc/hosts")).toBe(false));
  it("detects curl --output value as NOT read-only", () => expect(isReadOnlyCommand("curl --output /tmp/out file:///etc/hosts")).toBe(false));
  it("detects curl --output=value as NOT read-only", () => expect(isReadOnlyCommand("curl --output=/tmp/out file:///etc/hosts")).toBe(false));
  it("detects curl -d joined data as NOT read-only", () => expect(isReadOnlyCommand("curl -dsecret=1 https://example.invalid")).toBe(false));
  it("detects curl --data=value as NOT read-only", () => expect(isReadOnlyCommand("curl --data=secret=1 https://example.invalid")).toBe(false));
  it("detects curl -X joined method as NOT read-only", () => expect(isReadOnlyCommand("curl -XPOST https://example.invalid")).toBe(false));
  it("detects curl --request=value as NOT read-only", () => expect(isReadOnlyCommand("curl --request=POST https://example.invalid")).toBe(false));
  it("detects curl --upload-file=value as NOT read-only", () => expect(isReadOnlyCommand("curl --upload-file=/etc/hosts https://example.invalid")).toBe(false));
  it("detects bundled curl short output flag as NOT read-only", () => expect(isReadOnlyCommand("curl -sSo/tmp/out file:///etc/hosts")).toBe(false));
  it("detects bundled curl short method flag as NOT read-only", () => expect(isReadOnlyCommand("curl -sXPOST https://example.invalid")).toBe(false));
  it("detects bundled curl short data flag as NOT read-only", () => expect(isReadOnlyCommand("curl -sdsecret=1 https://example.invalid")).toBe(false));
  it("detects abbreviated curl upload flag as NOT read-only", () => expect(isReadOnlyCommand("curl --up /etc/hosts file:///tmp/coders-upload")).toBe(false));
  it("detects curl config file as NOT read-only", () => expect(isReadOnlyCommand("curl -K/tmp/curl.conf")).toBe(false));
  it("detects curl --config as NOT read-only", () => expect(isReadOnlyCommand("curl --config /tmp/curl.conf")).toBe(false));
  it("detects curl cookie jar output as NOT read-only", () => expect(isReadOnlyCommand("curl -c/tmp/cookies file:///etc/hosts")).toBe(false));
  it("detects curl dump-header output as NOT read-only", () => expect(isReadOnlyCommand("curl -D/tmp/headers file:///etc/hosts")).toBe(false));
  it("detects curl trace output as NOT read-only", () => expect(isReadOnlyCommand("curl --trace /tmp/trace file:///etc/hosts")).toBe(false));

  // find can execute commands or write output files
  it("detects find -exec as NOT read-only", () => expect(isReadOnlyCommand("find . -maxdepth 0 -exec curl https://example.invalid \\;")).toBe(false));
  it("detects find -execdir as NOT read-only", () => expect(isReadOnlyCommand("find . -execdir touch {} \\;")).toBe(false));
  it("detects find -delete as NOT read-only", () => expect(isReadOnlyCommand("find . -delete")).toBe(false));
  it("detects find -fprint as NOT read-only", () => expect(isReadOnlyCommand("find . -fprint /tmp/out")).toBe(false));

  // Dangerous commands
  it("detects rm as NOT read-only", () => expect(isReadOnlyCommand("rm -rf /")).toBe(false));
  it("detects mkdir as NOT read-only", () => expect(isReadOnlyCommand("mkdir foo")).toBe(false));
  it("detects mv as NOT read-only", () => expect(isReadOnlyCommand("mv a b")).toBe(false));
  it("detects chmod as NOT read-only", () => expect(isReadOnlyCommand("chmod 755 file")).toBe(false));

  // Pipes — all parts must be read-only
  it("detects pipe of read-only commands", () => expect(isReadOnlyCommand("ls | grep foo")).toBe(true));
  it("detects pipe with write command", () => expect(isReadOnlyCommand("ls | tee output.txt")).toBe(false));

  // Chained with &&
  it("detects chain of read-only commands", () => expect(isReadOnlyCommand("git status && git diff")).toBe(true));
  it("detects chain with write command", () => expect(isReadOnlyCommand("git status && git push")).toBe(false));
  it("detects background chain with write command", () => expect(isReadOnlyCommand("ls & touch /tmp/coders-bg-repro")).toBe(false));
  it("detects newline chain with write command", () => expect(isReadOnlyCommand("ls\ntouch /tmp/coders-nl-repro")).toBe(false));
  it("detects hash command remapping as NOT read-only", () => expect(isReadOnlyCommand("hash -p /usr/bin/curl ls; ls https://example.invalid")).toBe(false));
  it("detects leading env assignment as NOT read-only", () => expect(isReadOnlyCommand("FOO=bar ls")).toBe(false));
  it("detects git external diff env override as NOT read-only", () => expect(isReadOnlyCommand("GIT_EXTERNAL_DIFF=/usr/bin/curl git diff")).toBe(false));
  it("detects pager env override as NOT read-only", () => expect(isReadOnlyCommand("PAGER=/usr/bin/curl git log -1")).toBe(false));

  // Empty
  it("detects empty command as NOT read-only", () => expect(isReadOnlyCommand("")).toBe(false));

  // Read-only keywords
  it("detects 'terraform plan' via keyword", () => expect(isReadOnlyCommand("terraform plan")).toBe(true));
  it("detects 'helm list' via keyword", () => expect(isReadOnlyCommand("helm list")).toBe(true));
  it("detects terraform state list as read-only", () => expect(isReadOnlyCommand("terraform state list")).toBe(true));
  it("detects terraform providers as read-only", () => expect(isReadOnlyCommand("terraform providers")).toBe(true));
  it("detects terraform providers schema as read-only", () => expect(isReadOnlyCommand("terraform providers schema")).toBe(true));
  it("detects helm repo list as read-only", () => expect(isReadOnlyCommand("helm repo list")).toBe(true));
  it("detects terraform output as NOT read-only", () => expect(isReadOnlyCommand("terraform output -json")).toBe(false));
  it("detects raw terraform output as NOT read-only", () => expect(isReadOnlyCommand("terraform output -raw db_password")).toBe(false));
  it("detects terraform show as NOT read-only", () => expect(isReadOnlyCommand("terraform show")).toBe(false));
  it("detects terraform state pull as NOT read-only", () => expect(isReadOnlyCommand("terraform state pull")).toBe(false));
  it("detects terraform state show as NOT read-only", () => expect(isReadOnlyCommand("terraform state show aws_instance.x")).toBe(false));
  it("detects helm get manifest as NOT read-only", () => expect(isReadOnlyCommand("helm get manifest prod")).toBe(false));
  it("detects helm get values as NOT read-only", () => expect(isReadOnlyCommand("helm get values prod --all")).toBe(false));
  it("detects helm get all as NOT read-only", () => expect(isReadOnlyCommand("helm get all prod")).toBe(false));
  it("detects terraform fmt as NOT read-only", () => expect(isReadOnlyCommand("terraform fmt")).toBe(false));
  it("detects terraform plan -out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan -out=tfplan")).toBe(false));
  it("detects quoted terraform plan -out as NOT read-only", () => expect(isReadOnlyCommand('terraform plan "-out=tfplan"')).toBe(false));
  it("detects single-quoted terraform plan -out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan '-out=tfplan'")).toBe(false));
  it("detects escaped terraform plan -out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan -out\\=tfplan")).toBe(false));
  it("detects backslash-escaped terraform plan -out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan \\-out=tfplan")).toBe(false));
  it("detects double-dash terraform plan --out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan --out=tfplan")).toBe(false));
  it("detects double-dash terraform plan --out with separate value as NOT read-only", () => expect(isReadOnlyCommand("terraform plan --out tfplan")).toBe(false));
  it("detects quote-spliced terraform plan -out as NOT read-only", () => expect(isReadOnlyCommand('terraform plan -o""ut=tfplan')).toBe(false));
  it("detects ANSI-C quoted terraform plan -out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan $'-out' tfplan")).toBe(false));
  it("detects shell-expanded terraform plan -out separator as NOT read-only", () => expect(isReadOnlyCommand("terraform plan -out${IFS}tfplan")).toBe(false));
  it("detects shell-expanded terraform plan -out equals as NOT read-only", () => expect(isReadOnlyCommand("terraform plan -out$'='tfplan")).toBe(false));
  it("detects terraform plan -generate-config-out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan -generate-config-out=generated.tf")).toBe(false));
  it("detects quoted terraform plan -generate-config-out as NOT read-only", () => expect(isReadOnlyCommand('terraform plan "-generate-config-out=generated.tf"')).toBe(false));
  it("detects single-quoted terraform plan -generate-config-out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan '-generate-config-out=generated.tf'")).toBe(false));
  it("detects escaped terraform plan -generate-config-out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan -generate-config-out\\=generated.tf")).toBe(false));
  it("detects double-dash terraform plan --generate-config-out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan --generate-config-out=generated.tf")).toBe(false));
  it("detects quote-spliced terraform plan -generate-config-out as NOT read-only", () => expect(isReadOnlyCommand('terraform plan -generate-config-o""ut=generated.tf')).toBe(false));
  it("detects ANSI-C quoted terraform plan -generate-config-out as NOT read-only", () => expect(isReadOnlyCommand("terraform plan $'-generate-config-out=generated.tf'")).toBe(false));
  it("detects shell-expanded terraform plan -generate-config-out separator as NOT read-only", () => expect(isReadOnlyCommand("terraform plan -generate-config-out${IFS}generated.tf")).toBe(false));
  it("detects shell expansion in terraform plan args as NOT read-only", () => expect(isReadOnlyCommand("terraform plan ${TF_PLAN_ARGS}")).toBe(false));
  it("detects terraform providers lock as NOT read-only", () => expect(isReadOnlyCommand("terraform providers lock")).toBe(false));
  it("detects quoted terraform providers schema as read-only", () => expect(isReadOnlyCommand('terraform providers "schema"')).toBe(true));
  it("detects terraform providers mirror as NOT read-only", () => expect(isReadOnlyCommand("terraform providers mirror ./mirror")).toBe(false));
  it("detects terraform state rm as NOT read-only", () => expect(isReadOnlyCommand("terraform state rm aws_instance.x")).toBe(false));
  it("detects helm repo add as NOT read-only", () => expect(isReadOnlyCommand("helm repo add bitnami https://charts.bitnami.com/bitnami")).toBe(false));
  it("detects quoted helm repo list as read-only", () => expect(isReadOnlyCommand('helm repo "list"')).toBe(true));
  it("detects output redirection as NOT read-only", () => expect(isReadOnlyCommand("terraform state pull > terraform.tfstate")).toBe(false));
  it("detects command substitution as NOT read-only", () => expect(isReadOnlyCommand("ls $(touch /tmp/coders-subst)")).toBe(false));
  it("detects command substitution in terraform state as NOT read-only", () => expect(isReadOnlyCommand("terraform state list $(touch /tmp/coders-subst)")).toBe(false));
  it("detects command substitution in helm list as NOT read-only", () => expect(isReadOnlyCommand("helm list $(touch /tmp/coders-subst)")).toBe(false));
  it("detects backtick command substitution in helm version as NOT read-only", () => expect(isReadOnlyCommand("helm version `touch /tmp/coders-subst`")).toBe(false));
  it("detects process substitution as NOT read-only", () => expect(isReadOnlyCommand("ls <(touch /tmp/coders-procsubst)")).toBe(false));
  it("detects process substitution in terraform state as NOT read-only", () => expect(isReadOnlyCommand("terraform state list <(touch /tmp/coders-procsubst)")).toBe(false));
  it("detects process substitution in helm version as NOT read-only", () => expect(isReadOnlyCommand("helm version <(touch /tmp/coders-procsubst)")).toBe(false));
});
