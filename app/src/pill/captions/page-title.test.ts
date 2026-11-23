import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchPageTitle, titleFromHtml } from "@/pill/captions/page-title.ts";

describe("titleFromHtml", () => {
  it("prefers the Open Graph title", () => {
    const html = '<head><title>Site | Story</title><meta content="The story" property="og:title"></head>';
    assert.equal(titleFromHtml(html), "The story");
  });

  it("falls back to the Twitter card title", () => {
    const html = "<head><meta name='twitter:title' content='Card story'><title>Doc</title></head>";
    assert.equal(titleFromHtml(html), "Card story");
  });

  it("reads a JSON-LD headline, inside a @graph too", () => {
    const html =
      '<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","headline":"From data"}]}</script>' +
      "<title>Doc</title>";
    assert.equal(titleFromHtml(html), "From data");
  });

  it("skips broken JSON-LD and uses the document title", () => {
    const html = '<script type="application/ld+json">{not json</script><title> Plain\n  title </title>';
    assert.equal(titleFromHtml(html), "Plain title");
  });

  it("decodes entities", () => {
    assert.equal(titleFromHtml("<title>Tom &amp; Jerry &#8211; &#x2019;s</title>"), "Tom & Jerry – ’s");
  });

  it("names nothing for a page without a title", () => {
    assert.equal(titleFromHtml("<head><title>   </title></head>"), undefined);
  });
});

function pageResponse({
  body,
  type = "text/html; charset=utf-8",
  status = 200
}: {
  body: string;
  type?: string;
  status?: number;
}) {
  return Promise.resolve(
    new Response(body, {
      status,
      headers: {
        "content-type": type
      }
    })
  );
}

describe("fetchPageTitle", () => {
  it("reads the title of a web page", async () => {
    const title = await fetchPageTitle({
      url: "https://example.com/a",
      fetchPage: () => pageResponse({ body: "<title>Hello</title>" })
    });
    assert.equal(title, "Hello");
  });

  it("decodes the page in its declared charset", async () => {
    const bytes = new Uint8Array([
      0x3c, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e, 0xf9, 0xec, 0xe5, 0xed, 0x3c, 0x2f, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e
    ]);
    const title = await fetchPageTitle({
      url: "https://example.co.il/",
      fetchPage: () =>
        Promise.resolve(
          new Response(bytes, {
            headers: {
              "content-type": "text/html; charset=windows-1255"
            }
          })
        )
    });
    assert.equal(title, "שלום");
  });

  it("gives nothing for what is not a web page, or a failed request", async () => {
    const pdf = await fetchPageTitle({
      url: "https://example.com/a.pdf",
      fetchPage: () =>
        pageResponse({
          body: "%PDF",
          type: "application/pdf"
        })
    });
    const missing = await fetchPageTitle({
      url: "https://example.com/gone",
      fetchPage: () =>
        pageResponse({
          body: "<title>Not found</title>",
          status: 404
        })
    });
    const offline = await fetchPageTitle({
      url: "https://example.com/",
      fetchPage: () => Promise.reject(new Error("offline"))
    });
    assert.deepEqual([pdf, missing, offline], [undefined, undefined, undefined]);
  });
});
