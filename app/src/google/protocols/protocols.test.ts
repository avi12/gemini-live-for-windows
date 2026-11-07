import { Direction, GlicMessage, GlicState, PageError } from "./glic.ts";
import { HomeMessage } from "./home.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const REPOSITORY = path.resolve(import.meta.dirname, "../../../..");

// The wire values of `enum <name> { Key = "value" }` in a TypeScript source, by member
function enumValues({ file, name }: {
  file: string;
  name: string;
}) {
  const source = readFileSync(path.join(REPOSITORY, file), "utf8");
  const body = new RegExp(String.raw`enum ${name} \{([^}]*)\}`).exec(source)?.[1] ?? "";
  return [...body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map(([, member, value]) => [member, value]);
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// Mirrored as-const objects must carry exactly the wire values the other end declares
function assertMirrors({ mirror, file, name }: {
  mirror: Record<string, string>;
  file: string;
  name: string;
}) {
  const declared = enumValues({
    file,
    name
  });
  assert.ok(declared.length > 0, `${name} not found in ${file}`);
  assert.deepEqual(
    declared.map(([member, value]) => [lowerFirst(member ?? ""), value])
      .toSorted((first, second) => String(first[0]).localeCompare(String(second[0]))),
    Object.entries(mirror).toSorted((first, second) => first[0].localeCompare(second[0]))
  );
}

describe("mirrored wire values", () => {
  test("glic messages", () => {
    assertMirrors({
      mirror: GlicMessage,
      file: "bridge/glic/glic_protocol.ts",
      name: "GlicMessage"
    });
  });

  test("page error codes", () => {
    const declared = enumValues({
      file: "bridge/glic/glic_protocol.ts",
      name: "ErrorMessage"
    }).map(([, value]) => value);
    for (const code of Object.values(PageError)) {
      assert.ok(declared.includes(code), `${code} is not a page error code`);
    }
  });

  test("glic states and directions", () => {
    assertMirrors({
      mirror: GlicState,
      file: "bridge/glic/glic_protocol.ts",
      name: "State"
    });
    assertMirrors({
      mirror: Direction,
      file: "bridge/glic/glic_protocol.ts",
      name: "Direction"
    });
  });

  test("home messages", () => {
    assertMirrors({
      mirror: HomeMessage,
      file: "bridge/home/home_protocol.ts",
      name: "HomeMessage"
    });
  });
});
