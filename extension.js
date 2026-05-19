const { registerBugReportBuilder } = require("./src/bugReportBuilder");

function activate(context) {
  registerBugReportBuilder(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
