import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_FEED_URL, FEED_URL_VARIABLE, latestRelease } from "./release-feed.ts";

const HTTP_OK = 200;
const HASH = "CA946C8E5A623EE921B0FA84DDD755CFD9001719F5CB1BCE639082A742CE3B62";
const GOOD = {
  version: "0.1.0.0",
  url: "https://github.com/avi12/gemini-live-for-windows/releases/download/v0.1.0/GeminiLive-0.1.0.msix",
  sha256: HASH
};

function feedReturning({ body, status = HTTP_OK }: { body: unknown; status?: number }) {
  const requested: string[] = [];
  async function fetchFeed(input: Parameters<typeof fetch>[0]) {
    requested.push(String(input));
    return new Response(JSON.stringify(body), { status });
  }
  return {
    fetchFeed,
    requested
  };
}

describe("latestRelease", () => {
  it("reads the checked-in manifest shape from the default address", async () => {
    const { fetchFeed, requested } = feedReturning({ body: GOOD });
    const release = await latestRelease({
      fetchFeed,
      env: {}
    });
    assert.deepEqual(release, {
      version: GOOD.version,
      msixUrl: GOOD.url,
      sha256: HASH
    });
    assert.deepEqual(requested, [DEFAULT_FEED_URL]);
  });

  it("honours the feed override variable", async () => {
    const { fetchFeed, requested } = feedReturning({ body: GOOD });
    await latestRelease({
      fetchFeed,
      env: {
        [FEED_URL_VARIABLE]: "http://localhost:9/updates.json"
      }
    });
    assert.deepEqual(requested, ["http://localhost:9/updates.json"]);
  });

  it("treats 404 as no release", async () => {
    const { fetchFeed } = feedReturning({
      body: {},
      status: 404
    });
    assert.equal(
      await latestRelease({
        fetchFeed,
        env: {}
      }),
      undefined
    );
  });

  it("throws on a server error", async () => {
    const { fetchFeed } = feedReturning({
      body: {},
      status: 500
    });
    await assert.rejects(
      latestRelease({
        fetchFeed,
        env: {}
      })
    );
  });

  it("never offers an untrusted manifest", async () => {
    const bad = [
      {
        ...GOOD,
        sha256: "abc"
      },
      {
        ...GOOD,
        sha256: "Z".repeat(HASH.length)
      },
      {
        ...GOOD,
        version: "one"
      },
      {
        ...GOOD,
        url: "http://example.com/a.msix"
      },
      {
        ...GOOD,
        url: "not a url"
      },
      { version: "1.0.0.0" }
    ];
    for (const body of bad) {
      const { fetchFeed } = feedReturning({ body });
      assert.equal(
        await latestRelease({
          fetchFeed,
          env: {}
        }),
        undefined,
        JSON.stringify(body)
      );
    }
  });

  it("allows plain http on localhost for testing", async () => {
    const { fetchFeed } = feedReturning({
      body: {
        ...GOOD,
        url: "http://localhost:8080/a.msix"
      }
    });
    assert.ok(
      await latestRelease({
        fetchFeed,
        env: {}
      })
    );
  });
});
