import type { BrowserCookie } from "@gemini-live/protocol/link";
import { z } from "zod";

import type {
  PermissionDecision,
  PermissionKind,
  ProcessFailureKind,
  WebViewCore,
  WebViewFactory,
  WebViewOptions
} from "./web-view-port.ts";

const requestSchema = z.object({
  id: z.number(),
  type: z.string()
});

// A WebViewCore that records what the host did to it and lets a test play the page: the stand-in
// for a window in every test that needs a web view.
interface Recorded {
  navigations: string[];
  posted: unknown[];
  scripts: string[];
  blocked: string[];
  cookies: BrowserCookie[][];
  devTools: {
    method: string;
    params: object;
  }[];
  answers: Map<string, unknown>;
}

interface Hooks {
  source: string;
  reloads: number;
  messageListener: ((json: string) => void) | undefined;
  failureListener: ((kind: ProcessFailureKind) => void) | undefined;
  permissionDecider: ((kind: PermissionKind) => PermissionDecision) | undefined;
  navigationFilter: ((uri: string) => boolean) | undefined;
}

function createFakeCore({
  recorded,
  hooks,
  fromPage
}: {
  recorded: Recorded;
  hooks: Hooks;
  fromPage: (envelope: object) => void;
}) {
  const { navigations, posted, scripts, blocked, cookies, devTools, answers } = recorded;
  return {
    get source() {
      return hooks.source;
    },
    navigate(url) {
      hooks.source = url;
      navigations.push(url);
    },
    reload() {
      hooks.reloads += 1;
    },
    // Every request the host sends is answered at once with answers[type] (null by default), as a
    // page whose bridge is listening would
    postMessage(json) {
      const envelope: unknown = JSON.parse(json);
      posted.push(envelope);
      const request = requestSchema.safeParse(envelope);
      if (!request.success) {
        return;
      }

      queueMicrotask(() =>
        fromPage({
          replyTo: request.data.id,
          res: answers.get(request.data.type) ?? null
        })
      );
    },
    onMessage(listener) {
      hooks.messageListener = listener;
    },
    onProcessFailed(listener) {
      hooks.failureListener = listener;
    },
    onPermission(decide) {
      hooks.permissionDecider = decide;
    },
    onNavigation(isAllowed) {
      hooks.navigationFilter = isAllowed;
    },
    async injectScript(code) {
      scripts.push(code);
    },
    blockRequests(filter) {
      blocked.push(filter);
    },
    setCookies(saved) {
      cookies.push([...saved]);
    },
    async callDevTools(request) {
      devTools.push(request);
    }
  } satisfies WebViewCore;
}

function createFakeWebView() {
  const hooks: Hooks = {
    source: "",
    reloads: 0,
    messageListener: undefined,
    failureListener: undefined,
    permissionDecider: undefined,
    navigationFilter: undefined
  };
  const recorded: Recorded = {
    navigations: [],
    posted: [],
    scripts: [],
    blocked: [],
    cookies: [],
    devTools: [],
    answers: new Map<string, unknown>()
  };
  const { navigations, posted, scripts, blocked, cookies, devTools, answers } = recorded;

  // The page speaks: one envelope, as WebMessageReceived delivers it
  function fromPage(envelope: object) {
    hooks.messageListener?.(JSON.stringify(envelope));
  }

  const core = createFakeCore({
    recorded,
    hooks,
    fromPage
  });

  return {
    core,
    navigations,
    posted,
    scripts,
    blocked,
    cookies,
    devTools,
    answers,
    fromPage,
    get reloads() {
      return hooks.reloads;
    },
    fail: (kind: ProcessFailureKind) => hooks.failureListener?.(kind),
    decide: (kind: PermissionKind) => hooks.permissionDecider?.(kind),
    allows: (uri: string) => hooks.navigationFilter?.(uri),
    // The requests the host sent the page, newest last
    requestsOf: (type: string) =>
      posted.filter(
        envelope => typeof envelope === "object" && envelope !== null && "type" in envelope && envelope.type === type
      )
  };
}

export type FakeWebView = ReturnType<typeof createFakeWebView>;

export function createFakeWebViewFactory() {
  const views: FakeWebView[] = [];

  const factory: WebViewFactory = {
    async create(_options: WebViewOptions) {
      const view = createFakeWebView();
      views.push(view);
      return view.core;
    }
  };

  return {
    ...factory,
    views,
    get latest() {
      return views.at(-1);
    }
  };
}
