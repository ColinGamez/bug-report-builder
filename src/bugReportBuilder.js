const vscode = require("vscode");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { projectSnapshot } = require("./project");

const BUG_REPORT_FILE = "BUG_REPORT.md";
const DIAGNOSTIC_LABELS = {
  [vscode.DiagnosticSeverity.Error]: "error",
  [vscode.DiagnosticSeverity.Warning]: "warning",
  [vscode.DiagnosticSeverity.Information]: "info",
  [vscode.DiagnosticSeverity.Hint]: "hint"
};

function normalizeLineEndings(value) {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

function relativePath(root, filePath) {
  if (!filePath) {
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(filePath) && !path.isAbsolute(filePath)) {
    return filePath;
  }

  if (!root) {
    return filePath.replace(/\\/g, "/");
  }

  const relative = path.relative(root, filePath);
  return (relative && !relative.startsWith("..") ? relative : filePath).replace(/\\/g, "/");
}

function markdownFence(languageId, text) {
  const body = normalizeLineEndings(text).trimEnd();
  let fence = "```";

  while (body.includes(fence)) {
    fence += "`";
  }

  return `${fence}${languageId || ""}\n${body || "_No content captured._"}\n${fence}`;
}

function markdownList(items, emptyText) {
  if (!items.length) {
    return emptyText;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function numberedSteps(steps) {
  if (!steps.length) {
    return "1. _Add the first step._\n2. _Add what happens next._\n3. _Add the exact failure._";
  }

  return steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

function activeEditorContext() {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return {
      editor: undefined,
      document: undefined,
      selectedText: "",
      selectionRange: "",
      languageId: "",
      filePath: "",
      diagnostics: []
    };
  }

  const document = editor.document;
  const selectedText = editor.selection.isEmpty ? "" : document.getText(editor.selection);
  const start = editor.selection.start.line + 1;
  const end = editor.selection.end.line + 1;
  const selectionRange = selectedText ? (start === end ? `line ${start}` : `lines ${start}-${end}`) : "";

  return {
    editor,
    document,
    selectedText,
    selectionRange,
    languageId: document.languageId || "plaintext",
    filePath: document.uri.scheme === "file" ? document.uri.fsPath : document.uri.toString(),
    diagnostics: vscode.languages.getDiagnostics(document.uri)
  };
}

function diagnosticLocation(diagnostic) {
  const start = diagnostic.range.start;
  const end = diagnostic.range.end;
  const line = start.line + 1;
  const column = start.character + 1;

  if (end.line !== start.line) {
    return `${line}:${column}-${end.line + 1}:${end.character + 1}`;
  }

  return `${line}:${column}`;
}

function diagnosticCode(code) {
  if (code === undefined || code === null) {
    return "";
  }

  if (typeof code === "object" && code.value !== undefined) {
    return code.value;
  }

  return code;
}

function formatDiagnostics(diagnostics) {
  if (!diagnostics.length) {
    return "_No diagnostics reported for the active file._";
  }

  return diagnostics
    .slice(0, 25)
    .map((diagnostic) => {
      const severity = DIAGNOSTIC_LABELS[diagnostic.severity] || "diagnostic";
      const source = diagnostic.source ? ` ${diagnostic.source}` : "";
      const code = diagnostic.code ? ` (${diagnosticCode(diagnostic.code)})` : "";
      return `- ${severity.toUpperCase()} ${diagnosticLocation(diagnostic)}${source}${code}: ${diagnostic.message.replace(/\s+/g, " ")}`;
    })
    .join("\n")
    + (diagnostics.length > 25 ? `\n- _${diagnostics.length - 25} more diagnostics omitted._` : "");
}

function workspaceDiagnosticSummary() {
  const counts = {
    error: 0,
    warning: 0,
    info: 0,
    hint: 0
  };

  for (const [, diagnostics] of vscode.languages.getDiagnostics()) {
    for (const diagnostic of diagnostics) {
      const label = DIAGNOSTIC_LABELS[diagnostic.severity] || "info";
      counts[label] = (counts[label] || 0) + 1;
    }
  }

  return `Errors: ${counts.error}, Warnings: ${counts.warning}, Info: ${counts.info}, Hints: ${counts.hint}`;
}

function installedExtensionLines(limit = 80) {
  const extensions = vscode.extensions.all
    .filter((extension) => !extension.id.startsWith("vscode."))
    .map((extension) => {
      const version = extension.packageJSON?.version ? `@${extension.packageJSON.version}` : "";
      return `${extension.id}${version}`;
    })
    .sort((a, b) => a.localeCompare(b));

  const lines = extensions.slice(0, limit).map((extension) => `- ${extension}`);

  if (extensions.length > limit) {
    lines.push(`- _${extensions.length - limit} more extensions omitted._`);
  }

  return lines.length ? lines.join("\n") : "_No non-built-in extensions detected._";
}

function projectInfoLines(snapshot, active) {
  const lines = [
    `- Workspace: ${snapshot.name || "No workspace"}`,
    `- Project types: ${(snapshot.projectTypes || []).join(", ") || "unknown"}`,
    `- Package manager: ${snapshot.packageManager || "unknown"}`,
    `- Git branch: ${snapshot.git?.branch || "unknown"}`,
    `- Working tree changes: ${snapshot.git?.changes ?? "unknown"}`,
    `- Active file: ${relativePath(snapshot.root, active.filePath) || "none"}`,
    `- Language: ${active.languageId || "none"}`,
    `- Selected code: ${active.selectedText ? active.selectionRange : "none"}`,
    `- Workspace diagnostics: ${workspaceDiagnosticSummary()}`
  ];

  if (snapshot.git?.remoteUrl) {
    lines.splice(5, 0, `- Repository: ${snapshot.git.remoteUrl}`);
  }

  return lines.join("\n");
}

function environmentLines(context) {
  return [
    `- VS Code: ${vscode.version}`,
    `- Extension: Colin's Bug Report Builder ${context.extension.packageJSON.version}`,
    `- OS: ${os.type()} ${os.release()} ${os.arch()}`,
    `- Platform: ${process.platform}`,
    `- Node: ${process.version}`
  ].join("\n");
}

function defaultIssueTitle(snapshot, active) {
  const target = active.filePath ? path.basename(active.filePath) : snapshot.name || "workspace";
  return `Bug: ${target}`;
}

async function collectReproSteps() {
  const steps = [];

  for (let index = 1; index <= 6; index += 1) {
    const step = await vscode.window.showInputBox({
      title: "Bug Report Builder",
      prompt: index === 1 ? "First reproduction step. Leave blank to skip steps." : `Step ${index}. Leave blank to finish.`,
      placeHolder: index === 1 ? "Open the page, run the command, click the button..." : "What happens next?"
    });

    if (step === undefined) {
      return undefined;
    }

    if (!step.trim()) {
      break;
    }

    steps.push(step.trim());
  }

  return steps;
}

async function askBoolean(title, placeHolder, yesLabel = "Yes", noLabel = "No") {
  const choice = await vscode.window.showQuickPick(
    [
      { label: yesLabel, value: true },
      { label: noLabel, value: false }
    ],
    { title, placeHolder }
  );

  return choice?.value === true;
}

function buildBugReport({ context, snapshot, active, title, observed, expected, steps, includeSelection, includeExtensions }) {
  const sections = [
    `# ${title}`,
    "## Summary",
    observed || "_Describe what went wrong._",
    "## Expected Behavior",
    expected || "_Describe what should have happened._",
    "## Steps To Reproduce",
    numberedSteps(steps),
    "## Project Context",
    projectInfoLines(snapshot, active),
    "## Active File Diagnostics",
    formatDiagnostics(active.diagnostics),
    "## Environment",
    environmentLines(context),
    "## Logs / Terminal Output",
    "_Paste relevant terminal output, console errors, stack traces, or screenshots here._"
  ];

  if (includeSelection && active.selectedText) {
    sections.splice(
      8,
      0,
      "## Selected Code",
      `File: \`${relativePath(snapshot.root, active.filePath)}\` (${active.selectionRange})`,
      markdownFence(active.languageId, active.selectedText)
    );
  }

  if (includeExtensions) {
    sections.push("## Installed Extensions", installedExtensionLines());
  }

  return `${sections.join("\n\n")}\n`;
}

async function saveBugReport(markdown, openAfterSave) {
  const snapshot = projectSnapshot();

  if (!snapshot.root) {
    vscode.window.showWarningMessage("Bug Report Builder needs an open workspace before it can save BUG_REPORT.md.");
    return;
  }

  const filePath = path.join(snapshot.root, BUG_REPORT_FILE);

  if (fs.existsSync(filePath)) {
    const answer = await vscode.window.showWarningMessage("Overwrite BUG_REPORT.md?", { modal: false }, "Overwrite");

    if (answer !== "Overwrite") {
      return;
    }
  }

  await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(markdown, "utf8"));

  if (openAfterSave) {
    await vscode.window.showTextDocument(vscode.Uri.file(filePath));
  }

  vscode.window.showInformationMessage(`Bug Report Builder: saved ${BUG_REPORT_FILE}.`);
}

async function openBugReportDraft(markdown) {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: markdown
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

async function createBugReport(context) {
  const snapshot = projectSnapshot();
  const active = activeEditorContext();
  const title = await vscode.window.showInputBox({
    title: "Bug Report Builder",
    prompt: "Bug report title",
    value: defaultIssueTitle(snapshot, active),
    validateInput: (value) => (value.trim() ? undefined : "A title is required.")
  });

  if (!title) {
    return;
  }

  const observed = await vscode.window.showInputBox({
    title: "Bug Report Builder",
    prompt: "What is going wrong?",
    placeHolder: "The app crashes when..., the command fails after..."
  });

  if (observed === undefined) {
    return;
  }

  const expected = await vscode.window.showInputBox({
    title: "Bug Report Builder",
    prompt: "What did you expect instead?",
    placeHolder: "It should save the file, render the page, complete the command..."
  });

  if (expected === undefined) {
    return;
  }

  const steps = await collectReproSteps();

  if (steps === undefined) {
    return;
  }

  const includeSelection = active.selectedText
    ? await askBoolean("Bug Report Builder", `Include selected code from ${active.selectionRange}?`, "Include Selection", "Skip Selection")
    : false;
  const includeExtensions = await askBoolean(
    "Bug Report Builder",
    "Include installed extension IDs and versions? This can help debug extension conflicts.",
    "Include Extensions",
    "Skip Extensions"
  );
  const markdown = buildBugReport({
    context,
    snapshot,
    active,
    title: title.trim(),
    observed: observed.trim(),
    expected: expected.trim(),
    steps,
    includeSelection,
    includeExtensions
  });
  const action = await vscode.window.showQuickPick(
    [
      { label: "Open Draft", description: "Open an unsaved Markdown report", action: "open" },
      { label: "Copy Markdown", description: "Copy the report to clipboard", action: "copy" },
      { label: "Save BUG_REPORT.md", description: "Save in the workspace root", action: "save" },
      { label: "Save And Open BUG_REPORT.md", description: "Save, then open the file", action: "saveOpen" }
    ],
    {
      title: "Bug Report Builder",
      placeHolder: "Choose what to do with the generated report"
    }
  );

  if (!action) {
    return;
  }

  if (action.action === "copy") {
    await vscode.env.clipboard.writeText(markdown);
    vscode.window.showInformationMessage("Bug Report Builder: Markdown copied.");
    return;
  }

  if (action.action === "save" || action.action === "saveOpen") {
    await saveBugReport(markdown, action.action === "saveOpen");
    return;
  }

  await openBugReportDraft(markdown);
}

function registerBugReportBuilder(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("bug-report-builder.create", () => createBugReport(context))
  );
}

module.exports = { registerBugReportBuilder };
