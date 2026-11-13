import fileSystem from "node:fs";

import { stripSignature } from "../../app/src/entry/sea/pe-signature.ts";
import { PeSubsystem, readSubsystem, setSubsystem } from "../../app/src/entry/sea/pe-subsystem.ts";
import { seaStubSource } from "../../app/src/entry/sea/sea-stub.ts";

// The two build steps that are code rather than shell, kept in TypeScript beside their unit tests
// (app/src/entry). Build-SeaExe.ps1 calls them.
const Command = {
  STUB: "stub",
  GUI_SUBSYSTEM: "gui-subsystem",
  STRIP_SIGNATURE: "strip-signature",
  SUBSYSTEM: "subsystem"
} as const;

const [command, file] = process.argv.slice(2);
if (file === undefined) {
  throw new Error(`Usage: prepare.ts <${Object.values(Command).join("|")}> <file>`);
}

if (command === Command.STUB) {
  fileSystem.writeFileSync(file, seaStubSource());
} else if (command === Command.GUI_SUBSYSTEM) {
  const image = fileSystem.readFileSync(file);
  setSubsystem({
    image,
    subsystem: PeSubsystem.WINDOWS_GUI
  });
  fileSystem.writeFileSync(file, image);
} else if (command === Command.STRIP_SIGNATURE) {
  fileSystem.writeFileSync(file, stripSignature(fileSystem.readFileSync(file)));
} else if (command === Command.SUBSYSTEM) {
  process.stdout.write(`${readSubsystem(fileSystem.readFileSync(file))}\n`);
} else {
  throw new Error(`Unknown command ${command}`);
}
