const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SCRIPT_PRIORITY = ["dev", "start", "watch", "serve", "preview", "build", "test", "lint", "format", "package"];

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function existsAt(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function findFirstPath(root, candidates) {
  return candidates.find((candidate) => existsAt(root, candidate));
}

function dependencyNames(packageJson) {
  return new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {})
  ]);
}

function projectTypes(root, packageJson) {
  const deps = dependencyNames(packageJson);
  const types = [];

  if (packageJson?.contributes || packageJson?.engines?.vscode) {
    types.push("VS Code Extension");
  }

  if (deps.has("next") || existsAt(root, "next.config.js") || existsAt(root, "next.config.mjs")) {
    types.push("Next.js");
  }

  if (deps.has("vite") || existsAt(root, "vite.config.js") || existsAt(root, "vite.config.ts")) {
    types.push("Vite");
  }

  if (deps.has("react")) {
    types.push("React");
  }

  if (packageJson) {
    types.push("Node");
  }

  if (existsAt(root, "pyproject.toml") || existsAt(root, "requirements.txt")) {
    types.push("Python");
  }

  if (existsAt(root, "themes") && existsAt(root, "package.json")) {
    types.push("Theme Pack");
  }

  return [...new Set(types.length ? types : ["Workspace"])];
}

function detectPackageManager(root) {
  if (existsAt(root, "pnpm-lock.yaml")) {
    return "pnpm";
  }

  if (existsAt(root, "yarn.lock")) {
    return "yarn";
  }

  if (existsAt(root, "bun.lockb") || existsAt(root, "bun.lock")) {
    return "bun";
  }

  return "npm";
}

function scriptCommand(packageManager, scriptName) {
  if (packageManager === "pnpm") {
    return `pnpm run ${scriptName}`;
  }

  if (packageManager === "yarn") {
    return `yarn ${scriptName}`;
  }

  if (packageManager === "bun") {
    return `bun run ${scriptName}`;
  }

  return `npm run ${scriptName}`;
}

function sortedScripts(scripts = {}) {
  return Object.keys(scripts).sort((a, b) => {
    const aPriority = SCRIPT_PRIORITY.indexOf(a);
    const bPriority = SCRIPT_PRIORITY.indexOf(b);
    const normalizedA = aPriority === -1 ? Number.MAX_SAFE_INTEGER : aPriority;
    const normalizedB = bPriority === -1 ? Number.MAX_SAFE_INTEGER : bPriority;

    if (normalizedA !== normalizedB) {
      return normalizedA - normalizedB;
    }

    return a.localeCompare(b);
  });
}

function runGit(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500
    }).trim();
  } catch {
    return "";
  }
}

function normalizeRemoteUrl(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  let url = value.trim().replace(/^git\+/, "");

  if (url.startsWith("git@github.com:")) {
    url = `https://github.com/${url.slice("git@github.com:".length)}`;
  }

  if (url.startsWith("ssh://git@github.com/")) {
    url = `https://github.com/${url.slice("ssh://git@github.com/".length)}`;
  }

  if (url.endsWith(".git")) {
    url = url.slice(0, -4);
  }

  return url.startsWith("http://") || url.startsWith("https://") ? url : "";
}

function packageRepositoryUrl(packageJson) {
  const repository = packageJson?.repository;

  if (typeof repository === "string") {
    return normalizeRemoteUrl(repository);
  }

  return normalizeRemoteUrl(repository?.url);
}

function gitInfo(root, packageJson) {
  const branch = runGit(root, ["branch", "--show-current"]) || runGit(root, ["rev-parse", "--short", "HEAD"]);
  const status = runGit(root, ["status", "--short"]);
  const remote = runGit(root, ["config", "--get", "remote.origin.url"]);

  return {
    branch,
    changes: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
    remoteUrl: packageRepositoryUrl(packageJson) || normalizeRemoteUrl(remote),
    isRepo: Boolean(branch || remote)
  };
}

function projectHealth(root, packageJson) {
  const scripts = packageJson?.scripts ?? {};
  const checks = [
    {
      label: "README",
      ok: Boolean(findFirstPath(root, ["README.md", "readme.md"])),
      missing: "Missing README",
      create: "README.md"
    },
    {
      label: ".gitignore",
      ok: existsAt(root, ".gitignore"),
      missing: "Missing .gitignore",
      create: ".gitignore"
    },
    {
      label: "License",
      ok: Boolean(findFirstPath(root, ["LICENSE", "LICENSE.md", "license.md"])),
      missing: "Missing license"
    },
    {
      label: "CI workflow",
      ok: existsAt(root, ".github/workflows"),
      missing: "No GitHub Actions workflow"
    }
  ];

  if (packageJson) {
    checks.push(
      {
        label: "Build script",
        ok: Boolean(scripts.build),
        missing: "No build script"
      },
      {
        label: "Test script",
        ok: Boolean(scripts.test),
        missing: "No test script"
      },
      {
        label: "Lint script",
        ok: Boolean(scripts.lint),
        missing: "No lint script"
      }
    );
  }

  const ok = checks.filter((check) => check.ok).length;

  return {
    checks,
    ok,
    total: checks.length
  };
}

function projectSnapshot() {
  const root = workspaceRoot();

  if (!root) {
    return { root: undefined };
  }

  const packageJson = readJsonFile(path.join(root, "package.json"));
  const scripts = sortedScripts(packageJson?.scripts);
  const packageManager = detectPackageManager(root);
  const readme = findFirstPath(root, ["README.md", "readme.md"]);
  const health = projectHealth(root, packageJson);

  return {
    root,
    name: packageJson?.displayName || packageJson?.name || path.basename(root),
    packageJson,
    packageManager,
    projectTypes: projectTypes(root, packageJson),
    scripts,
    readme,
    git: gitInfo(root, packageJson),
    health
  };
}

function bestScript(snapshot) {
  return ["dev", "start", "serve", "preview", "build", "test"].find((scriptName) =>
    snapshot.scripts.includes(scriptName)
  );
}

module.exports = {
  SCRIPT_PRIORITY,
  workspaceRoot,
  existsAt,
  readJsonFile,
  findFirstPath,
  dependencyNames,
  projectTypes,
  detectPackageManager,
  scriptCommand,
  sortedScripts,
  runGit,
  normalizeRemoteUrl,
  packageRepositoryUrl,
  gitInfo,
  projectHealth,
  projectSnapshot,
  bestScript
};
