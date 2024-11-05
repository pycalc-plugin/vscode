const path = require('path');
const jsdom = require('jsdom');
const { parentPort } = require('worker_threads');

const stdin = [];
const stdout = [];
const stderr = [];
let brython = null;
let heartbeat = performance.now();

const brythonPath = path.join(__dirname, 'brython.min.js');
const stdlibPath = path.join(__dirname, 'brython_stdlib.js');

const html = `
<!doctype html>
<html>
    <head>
        <script type="text/javascript"
            src="file://${brythonPath}">
        </script>
        <script type="text/javascript"
            src="file://${stdlibPath}">
        </script>
    </head>
    <body onload="brython()">
    </body>
</html>
`

const pycode = `
import sys
import code
from browser import console, timer

class Stdout:
    buffer = ""
    request = ""

    def write(self, value):
        self.buffer += value

    def flush(self):
        if self.buffer == f"{self.request.strip()}\\n":
            self.buffer = ""
            return

        sys.__stdout__.write(self.buffer)
        sys.__stdout__.flush()
        self.buffer = ""


class Stderr:
    def write(self, value):
        console.error(value)

    def flush(self):
        pass


def interact():
    global repl

    line = input()
    if not line:
        return

    multiline, line = line[0], line[1:]
    sys.stdout.request = line
    try:
        if multiline == "1":
            repl.resetbuffer()
            repl.runcode(line)
        else:
            repl.push(line)
    except Exception as e:
        print(rerp(e))


sys.stderr = Stderr()
sys.stdout = Stdout()
timer.set_interval(interact, 10)
repl = code.InteractiveConsole()
`

function init() {
    const dom = new jsdom.JSDOM(html, { url: "http://localhost", runScripts: "dangerously", resources: "usable" });

    dom.window.addEventListener("load", () => {
        setInterval(function () {
            if (stdout.length > 0) {
                parentPort.postMessage({ "stdout": stdout });
                stdout.length = 0;
            }

            if (stderr.length > 0) {
                parentPort.postMessage({ "stderr": stderr });
                stderr.length = 0;
            }
        }, 10);

        dom.window.prompt = function () {
            const runs = performance.now() - heartbeat;

            if (runs > 3 * 1000) {
                let result = { "heartbeat": heartbeat };
                heartbeat = performance.now();
                parentPort.postMessage(result);
            }

            if (stdin.length == 0) {
                return null;
            }

            return stdin.shift();
        };

        dom.window.console.log = function (text) {
            stdout.push(text);
        };

        dom.window.console.error = function (text) {
            stderr.push(text);
        };

        brython = dom.window.__BRYTHON__;

        brython.runPythonSource(pycode);
    });
}


parentPort.on('message', (code) => {
    if (!brython) {
        return;
    }

    stdin.push(code);
});

init();
