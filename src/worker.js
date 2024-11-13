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
import code
import sys
import time
from browser import console, timer


def __sleep__(duration):
    delay = time.time() + duration
    while time.time() < delay:
        ...


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
        sys.__stderr__.write(value)
        sys.__stderr__.flush()

    def flush(self):
        sys.__stderr__.flush()


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
    except BaseException as e:
        sys.stderr.write(rerp(e))


sys.stderr = Stderr()
sys.stdout = Stdout()
time.sleep = __sleep__
timer.set_interval(interact, 10)
repl = code.InteractiveConsole()
`

function init() {
    const dom = new jsdom.JSDOM(html, { url: "http://localhost", runScripts: "dangerously", resources: "usable" });

    const input = () => {
        const runs = performance.now() - heartbeat;

        if (runs > 3 * 1000) {
            const result = { "heartbeat": heartbeat };
            heartbeat = performance.now();
            parentPort.postMessage(result);
        }

        if (stdin.length == 0) {
            return null;
        }

        return stdin.shift();
    }

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

        dom.window.prompt = input;

        brython = dom.window.__BRYTHON__;

        brython.imported._sys.stdin = {
            async readline() {
                return input();
            },
            read() {
                return input();
            }
        }

        brython.imported._sys.stdout = {
            write(content) {
                stdout.push(content);
            },
            flush() { },
        },

        brython.imported._sys.stderr = {
            write(content) {
                stderr.push(content);
            },
            flush() { },
        }

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
