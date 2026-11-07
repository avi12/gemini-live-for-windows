import { findLinks, shortTitle } from "@/pill/captions/link-extractor.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const SEARCH = "https://www.google.com/search?q=";

describe("findLinks", () => {
  it("finds nothing in plain speech", () => {
    assert.deepEqual(findLinks("It is sunny in Tel Aviv today."), []);
  });

  it("reads a markdown link with its own title", () => {
    assert.deepEqual(findLinks("See [the docs](https://example.com/docs) for more"), [
      {
        title: "the docs",
        uri: "https://example.com/docs",
        isSearch: false
      }
    ]);
  });

  it("titles a bare URL by its host and path", () => {
    assert.deepEqual(findLinks("Open https://news.example.org/2026/story/ now"), [
      {
        title: "news.example.org/2026/story",
        uri: "https://news.example.org/2026/story/",
        isSearch: false
      }
    ]);
  });

  it("trims the punctuation a sentence puts after a URL", () => {
    const [link] = findLinks("Go to https://example.com/a?b=1).");
    assert.equal(link?.uri, "https://example.com/a?b=1");
  });

  it("does not count a markdown link's URL a second time", () => {
    assert.equal(findLinks("[a](https://example.com/x) https://example.com/x").length, 1);
  });

  it("turns a spoken domain into an https link", () => {
    assert.deepEqual(findLinks("It was on gbhackers.com yesterday"), [
      {
        title: "gbhackers.com",
        uri: "https://gbhackers.com",
        isSearch: false
      }
    ]);
  });

  it("keeps a path on a spoken domain and drops the sentence's period", () => {
    const [link] = findLinks("Read theregister.co.uk/2026/05/story.");
    assert.equal(link?.uri, "https://theregister.co.uk/2026/05/story");
  });

  it("ignores words that only look like domains", () => {
    assert.deepEqual(findLinks("The file is called notes.txt and readme.md"), []);
  });

  it("does not read the host of a full URL as a bare domain too", () => {
    assert.equal(findLinks("https://example.com/page").length, 1);
  });

  it("turns a long quoted title into a Google search", () => {
    assert.deepEqual(findLinks("Search for \"Apple unveils new chip\" to read it"), [
      {
        title: "Apple unveils new chip",
        uri: `${SEARCH}Apple%20unveils%20new%20chip`,
        isSearch: true
      }
    ]);
  });

  it("accepts curly quotes", () => {
    const [link] = findLinks("Look up “Quantum computing breakthrough” online");
    assert.equal(link?.title, "Quantum computing breakthrough");
    assert.equal(link?.isSearch, true);
  });

  it("ignores a short quote", () => {
    assert.deepEqual(findLinks("He said \"hello there\""), []);
  });

  it("escapes the marks encodeURIComponent keeps, like .NET does", () => {
    const [link] = findLinks("Find \"What is (this)? it's odd!\" please");
    assert.equal(link?.uri, `${SEARCH}What%20is%20%28this%29%3F%20it%27s%20odd%21`);
  });

  it("drops a repeated address in any casing, keeping the first", () => {
    const links = findLinks("https://Example.com/A and https://example.com/a and example.com");
    assert.deepEqual(links.map(link => link.uri), ["https://Example.com/A", "https://example.com"]);
  });

  it("lists markdown first, then URLs, then domains, then searches", () => {
    const links = findLinks("\"A quoted headline here\" example.org https://b.com/x [t](https://a.com/y)");
    assert.deepEqual(links.map(link => link.uri), [
      "https://a.com/y",
      "https://b.com/x",
      "https://example.org",
      `${SEARCH}A%20quoted%20headline%20here`
    ]);
  });
});

describe("shortTitle", () => {
  it("is host and path without the trailing slash", () => {
    assert.equal(shortTitle("https://example.com/a/b/"), "example.com/a/b");
  });

  it("is just the host for a site root", () => {
    assert.equal(shortTitle("https://example.com/"), "example.com");
  });

  it("leaves out the port and the query", () => {
    assert.equal(shortTitle("http://localhost:8080/x?y=1"), "localhost/x");
  });

  it("is the text itself when it is not a URL", () => {
    assert.equal(shortTitle("not a url"), "not a url");
  });
});
