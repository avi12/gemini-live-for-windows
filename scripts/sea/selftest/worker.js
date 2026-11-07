import { parentPort } from "node:worker_threads";

const { DynWin32, DynWin32Unsafe } = await import(process.env.SEA_SELFTEST_DYNWINRT);
const getProcessId = DynWin32Unsafe.bind({
  dll: "kernel32.dll",
  entryPoint: "GetCurrentProcessId",
  parameters: [],
  returnType: "u32",
  captureLastError: false
});
const processId = DynWin32.toNumber(getProcessId.invoke([]).returnValue);
parentPort.postMessage(`ready worker=tla dynwinrt=ok pid=${processId}`);
