// A browser starts a native messaging host as `exe chrome-extension://<id>/`. Chrome, Edge, Brave
// and Chromium all pass the caller origin as the first argument.
export const HOST_ARGUMENT_PREFIX = "chrome-extension://";
export const MAIN_MODULE = "main.js";
export const HOST_MODULE = "host.js";

// The Node 24 SEA main must be CommonJS and can only require built-ins, so the injected code is a
// few lines that import the built ES module from the folder of the exe (beside node_modules).
export function seaStubSource() {
  return [
    "const { dirname, join } = require('node:path');",
    "const { pathToFileURL } = require('node:url');",
    `const isHost = String(process.argv[2] ?? '').startsWith('${HOST_ARGUMENT_PREFIX}');`,
    `const file = join(dirname(process.execPath), isHost ? '${HOST_MODULE}' : '${MAIN_MODULE}');`,
    "import(pathToFileURL(file).href).catch(error => { process.stderr.write(String(error?.stack ?? error) + '\\n'); process.exit(1); });",
    ""
  ].join("\n");
}
