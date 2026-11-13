import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCaptionLog, MAX_LINES } from "@/pill/captions/caption-log.ts";

function createLog() {
  const added: string[] = [];
  let changes = 0;
  const log = createCaptionLog({
    onChange() {
      changes += 1;
    },
    onLinkAdded: uri => added.push(uri)
  });
  return {
    log,
    added,
    get changes() {
      return changes;
    }
  };
}

describe("caption log lines", () => {
  it("starts empty", () => {
    const { log } = createLog();
    assert.deepEqual(log.lines, []);
    assert.deepEqual(log.links, []);
  });

  it("keeps updating the current utterance of the same speaker", () => {
    const { log } = createLog();
    log.show({
      text: "Hel",
      isUser: true
    });
    log.show({
      text: "Hello",
      isUser: true
    });
    assert.deepEqual(log.lines, [
      {
        id: "line-0",
        text: "Hello",
        isUser: true,
        isNote: false
      }
    ]);
  });

  it("starts a new line when the speaker changes", () => {
    const { log } = createLog();
    log.show({
      text: "Hi",
      isUser: true
    });
    log.show({
      text: "Hello!",
      isUser: false
    });
    log.show({
      text: "Hi again",
      isUser: true
    });
    assert.deepEqual(
      log.lines.map(line => [line.id, line.text, line.isUser]),
      [
        ["line-0", "Hi", true],
        ["line-1", "Hello!", false],
        ["line-2", "Hi again", true]
      ]
    );
  });

  it("keeps only the last six lines", () => {
    const { log } = createLog();
    const extra = 3;
    for (let iLine = 0; iLine < MAX_LINES + extra; iLine += 1) {
      log.show({
        text: `line ${iLine}`,
        isUser: iLine % 2 === 0
      });
    }

    assert.equal(log.lines.length, MAX_LINES);
    assert.equal(log.lines[0]?.text, "line 3");
    assert.equal(log.lines.at(-1)?.text, "line 8");
  });

  it("never overwrites a note, even when the speaker is Gemini", () => {
    const { log } = createLog();
    log.addNote("The session ended");
    log.show({
      text: "Back again",
      isUser: false
    });
    assert.deepEqual(
      log.lines.map(line => [line.text, line.isNote]),
      [
        ["The session ended", true],
        ["Back again", false]
      ]
    );
  });

  it("starts a user line after a note", () => {
    const { log } = createLog();
    log.addNote("Note");
    log.show({
      text: "Hi",
      isUser: true
    });
    assert.equal(log.lines.length, 2);
  });

  it("clears lines and links but keeps counting ids", () => {
    const { log } = createLog();
    log.show({
      text: "See example.com",
      isUser: false
    });
    log.clear();
    assert.equal(log.lines.length, 0);
    assert.equal(log.links.length, 0);
    log.show({
      text: "Again",
      isUser: false
    });
    assert.equal(log.lines[0]?.id, "line-2");
  });

  it("announces every change", () => {
    const fixture = createLog();
    fixture.log.show({
      text: "a",
      isUser: true
    });
    fixture.log.addNote("b");
    fixture.log.showLinks([]);
    fixture.log.clear();
    const expectedChanges = 4;
    assert.equal(fixture.changes, expectedChanges);
  });
});

describe("caption log links", () => {
  it("collects links from Gemini's words only", () => {
    const { log } = createLog();
    log.show({
      text: "Visit example.com",
      isUser: true
    });
    assert.deepEqual(log.links, []);
    log.show({
      text: "Visit example.com",
      isUser: false
    });
    assert.deepEqual(log.links, [
      {
        id: "link-2",
        title: "example.com",
        uri: "https://example.com",
        address: "example.com",
        isSearch: false
      }
    ]);
  });

  it("does not repeat a link as the utterance grows, in any casing", () => {
    const { log, added } = createLog();
    log.show({
      text: "See https://Example.com/A",
      isUser: false
    });
    log.show({
      text: "See https://example.com/a and more",
      isUser: false
    });
    assert.equal(log.links.length, 1);
    assert.deepEqual(added, ["https://Example.com/A"]);
  });

  it("adds links that came with an answer, once", () => {
    const { log } = createLog();
    const link = {
      title: "Weather",
      uri: "https://weather.example.com/tlv"
    };
    log.showLinks([link, link]);
    assert.deepEqual(log.links, [
      {
        id: "link-0",
        title: "Weather",
        uri: "https://weather.example.com/tlv",
        address: "weather.example.com/tlv",
        isSearch: false
      }
    ]);
  });

  it("drops an address that is not absolute", () => {
    const { log } = createLog();
    log.showLinks([
      {
        title: "Broken",
        uri: "not a link"
      }
    ]);
    assert.deepEqual(log.links, []);
  });

  it("forgets seen addresses after a clear", () => {
    const { log } = createLog();
    log.show({
      text: "example.com",
      isUser: false
    });
    log.clear();
    log.show({
      text: "example.com",
      isUser: false
    });
    assert.equal(log.links.length, 1);
  });

  it("shares one id counter between lines and links", () => {
    const { log } = createLog();
    log.show({
      text: "example.com",
      isUser: false
    });
    log.addNote("n");
    assert.deepEqual([log.lines[0]?.id, log.links[0]?.id, log.lines[1]?.id], ["line-0", "link-1", "line-2"]);
  });

  it("marks a quoted headline as a search", () => {
    const { log } = createLog();
    log.show({
      text: 'Search "Giant telescope spots new galaxy"',
      isUser: false
    });
    assert.equal(log.links[0]?.isSearch, true);
  });
});
