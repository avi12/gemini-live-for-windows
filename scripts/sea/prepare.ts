import { stripSignature } from "../../app/src/entry/sea/pe-signature.ts";
import { PeSubsystem, readSubsystem, setSubsystem } from "../../app/src/entry/sea/pe-subsystem.ts";
import { seaStubSource } from "../../app/src/entry/sea/sea-stub.ts";
import fs from "node:fs";

// The two build steps that are code rather than shell, kept in TypeScript beside their unit tests
// (app/src/entry). Build-SeaExe.ps1 calls them.
const Command = {
  stub: "stub",
  guiSubsystem: "gui-subsystem",
  stripSignature: "strip-signature",
  subsystem: "subsystem"
} as const;

const [command, file] = process.argv.slice(2);
if (file === undefined) {
  throw new Error(`Usage: prepare.ts <${Object.values(Command).join("|")}> <file>`);
}

if (command === Command.stub) {
  fs.writeFileSync(file, seaStubSource());
} else if (command === Command.guiSubsystem) {
  const image = fs.readFileSync(file);
  setSubsystem({
    image,
    subsystem: PeSubsystem.windowsGui
  });
  fs.writeFileSync(file, image);
} else if (command === Command.stripSignature) {
  fs.writeFileSync(file, stripSignature(fs.readFileSync(file)));
} else if (command === Command.subsystem) {
  process.stdout.write(`${readSubsystem(fs.readFileSync(file))}\n`);
} else {
  throw new Error(`Unknown command ${command}`);
}
