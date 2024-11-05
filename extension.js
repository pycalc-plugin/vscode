const path = require("path");
const vscode = require("vscode");
const { Worker } = require("worker_threads");

let state = null;
let worker = null;
let timeout = null;
let heartbeat = null;

const keyEnabled = "pycalc_enabled";


function executePythonCode(code, multiline) {
	if (multiline) {
		code = "1" + code;
	} else {
		code = "0" + code;
	}

	if (worker) {
		worker.postMessage(code);
	}
}

function printResult(text) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}
	const position = editor.selection.active;
	editor.edit(edit => {
		edit.insert(position, text);
	}, { undoStopBefore: false, undoStopAfter: false });
}

function onEnter() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	vscode.commands.executeCommand("type", { text: "\n" });

	const pos = editor.selection.active;
	let line = editor.document.lineAt(pos.line).text;
	line = line.substring(0, pos.character);

	executePythonCode(line, false);
}

function getCursorPos(selection) {
	if (selection.isReversed) {
		return selection.anchor;
	}

	return selection.active;
}

function calcSelected() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	const selection = editor.selection;
	const pycode = editor.document.getText(selection);

	if (!pycode.endsWith("\n")) {
		editor.edit(edit => {
			edit.insert(getCursorPos(selection), "\n");
		});
	}

	const pos = getCursorPos(selection);
	editor.selection = new vscode.Selection(pos, pos);

	executePythonCode(pycode, true);
}

function checkLongRunning() {
	timeout = setTimeout(() => {
		if (performance.now() - heartbeat < 10000) {
			checkLongRunning();
			return;
		}

		vscode.window.showWarningMessage(
			"The Python code has been running for a long time. Do you want to terminate it?", "Yes", "No")
			.then(answer => {
				if (answer === "Yes") {
					worker.terminate();
					worker = null;
					createWorker();
				}
				heartbeat = performance.now();
				checkLongRunning();
			});
	}, 1000);
}

function createWorker() {
	const workerPath = path.join(__dirname, "worker.js");
	worker = new Worker(workerPath);
	heartbeat = performance.now();

	worker.on("message", (message) => {
		if ("heartbeat" in message) {
			heartbeat = message["heartbeat"];
		}

		if ("stdout" in message) {
			let text = message["stdout"].join("");
			printResult(text)
		}

		if ("stderr" in message) {
			let error = message["stderr"].join("");

			const regex = /\)\n  (File "<console>", line \d+, in <module>.*)/s;
			const match = error.match(regex);
			if (match) {
				error = match[1]
			}
			vscode.window.showErrorMessage(error);
		}
	});

	worker.on("error", (error) => {
		vscode.window.showErrorMessage(error.toString());
	});
}

function isEnabled() {
	let enabled = state.get(keyEnabled);
	if (enabled === undefined) {
		enabled = true;
		state.update(keyEnabled, enabled);
	}

	return enabled;
}

function setEnabled(enabled) {
	state.update(keyEnabled, enabled);
}

function pluginEnable() {
	pluginDisable();

	createWorker();
	checkLongRunning();

	setEnabled(true);
	vscode.commands.executeCommand("setContext", "pycalc.enabled", isEnabled());
}

function pluginDisable() {
	if (worker) {
		clearTimeout(timeout);
		worker.terminate();
		worker = null;
	}

	setEnabled(false);
	vscode.commands.executeCommand("setContext", "pycalc.enabled", isEnabled());
}

async function activate(context) {
	state = context.globalState;

	if (isEnabled()) {
		pluginEnable();
	}

	const enter = vscode.commands.registerCommand("pycalc.enter", onEnter);
	const enable = vscode.commands.registerCommand("pycalc.enable", pluginDisable);
	const disable = vscode.commands.registerCommand("pycalc.disable", pluginEnable);
	const selected = vscode.commands.registerCommand("pycalc.selected", calcSelected);

	context.subscriptions.push(enter);
	context.subscriptions.push(enable);
	context.subscriptions.push(disable);
	context.subscriptions.push(selected);

	vscode.commands.executeCommand("setContext", "pycalc.enabled", isEnabled());
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
}
