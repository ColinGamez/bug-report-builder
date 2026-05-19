import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const command = pkg.contributes?.commands?.[0]?.command;

if (pkg.name !== "bug-report-builder") {
  throw new Error("package name must be bug-report-builder");
}

if (command !== "bug-report-builder.create") {
  throw new Error("expected bug-report-builder.create command");
}

for (const file of ["extension.js", "src/bugReportBuilder.js", "src/project.js"]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

console.log("Bug Report Builder package check passed.");
