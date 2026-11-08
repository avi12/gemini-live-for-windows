import {
  PermissionDecision,
  PermissionKind,
  ProcessFailureKind,
  type WebViewCore,
  type WebViewOptions
} from "./web-view-port.ts";
import type { Logger } from "@/google/ports.ts";
import { SameSite, sameSiteOf } from "@/google/session/cookies.ts";
import { errorMessage } from "@/lib/error-message.ts";
import type { BrowserCookie } from "@gemini-live/protocol/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppWindow } from "winui-svelte/window";

// Parked off-screen reads as occluded, which would throttle the page's timers; the voice must also
// play without a click inside the page. Both matter for glic and are harmless for Home.
const CHROMIUM_ARGUMENTS = "--autoplay-policy=no-user-gesture-required "
  + "--disable-features=CalculateNativeWinOcclusion "
  + "--disable-background-timer-throttling --disable-renderer-backgrounding";
// Port 0: Chromium picks a free port, so debugging never collides with another app's
const DEBUG_ARGUMENT = " --remote-debugging-port=0";
const PARKED_AT = -32_000;
const NO_CONTENT = 204;

type ValueOf<TObject> = TObject[keyof TObject];

interface WindowSpec {
  readonly title: string;
  readonly logTag: string;
  // Where this host keeps its browser profile; one per host so two Google sessions never share
  readonly profileDir: string;
  readonly width: number;
  readonly height: number;
}

// The generated bindings, loaded on first use so importing this module costs nothing
async function loadBindings() {
  const [
    webViewModule,
    environmentModule,
    optionsModule,
    sameSiteModule,
    permissionKindModule,
    permissionStateModule,
    failedKindModule,
    contextModule,
    streamModule,
    windowModule
  ] = await Promise.all([
    import("winui-svelte/bindings/microsoft/ui/xaml/controls/WebView2"),
    import("winui-svelte/bindings/microsoft/web/web-view2/core/CoreWebView2Environment"),
    import("winui-svelte/bindings/microsoft/web/web-view2/core/CoreWebView2EnvironmentOptions"),
    import("winui-svelte/bindings/microsoft/web/web-view2/core/CoreWebView2CookieSameSiteKind"),
    import("winui-svelte/bindings/microsoft/web/web-view2/core/CoreWebView2PermissionKind"),
    import("winui-svelte/bindings/microsoft/web/web-view2/core/CoreWebView2PermissionState"),
    import("winui-svelte/bindings/microsoft/web/web-view2/core/CoreWebView2ProcessFailedKind"),
    import("winui-svelte/bindings/microsoft/web/web-view2/core/CoreWebView2WebResourceContext"),
    import("winui-svelte/bindings/windows/storage/streams/InMemoryRandomAccessStream"),
    import("winui-svelte/window")
  ]);
  return {
    webViewClass: webViewModule.WebView2,
    environmentClass: environmentModule.CoreWebView2Environment,
    optionsClass: optionsModule.CoreWebView2EnvironmentOptions,
    sameSiteKind: sameSiteModule.CoreWebView2CookieSameSiteKind,
    permissionKind: permissionKindModule.CoreWebView2PermissionKind,
    permissionState: permissionStateModule.CoreWebView2PermissionState,
    failedKind: failedKindModule.CoreWebView2ProcessFailedKind,
    resourceContext: contextModule.CoreWebView2WebResourceContext,
    streamClass: streamModule.InMemoryRandomAccessStream,
    createWindow: windowModule.createWindow
  };
}

type Bindings = Awaited<ReturnType<typeof loadBindings>>;
type Core = InstanceType<Bindings["webViewClass"]>["coreWebView2"];
type Environment = Awaited<ReturnType<Bindings["environmentClass"]["createWithOptionsAsync"]>>;

function createCookieWriter({ core, bindings, log }: {
  core: Core;
  bindings: Bindings;
  log: Logger;
}) {
  const sameSiteKinds = new Map<string, ValueOf<typeof bindings.sameSiteKind>>([
    [SameSite.strict, bindings.sameSiteKind.Strict],
    [SameSite.lax, bindings.sameSiteKind.Lax],
    [SameSite.none, bindings.sameSiteKind.None]
  ]);

  return function setCookie(saved: BrowserCookie) {
    const cookie = core.cookieManager.createCookie(saved.name, saved.value, saved.domain, saved.path);
    cookie.isSecure = saved.secure;
    cookie.isHttpOnly = saved.httpOnly;
    cookie.sameSite = sameSiteKinds.get(sameSiteOf(saved.sameSite)) ?? bindings.sameSiteKind.None;

    const expiry = saved.expirationDate;
    const hasExpiry = typeof expiry === "number";
    if (hasExpiry) {
      cookie.expires = expiry;
    }

    try {
      core.cookieManager.addOrUpdateCookie(cookie);
    } catch (error) {
      log.write(`cookie ${saved.name}@${saved.domain} rejected: ${errorMessage(error)}`);
    }
  };
}

function bindEvents({ core, bindings }: {
  core: Core;
  bindings: Bindings;
}) {
  const permissionKinds = new Map<number, PermissionKind>([
    [bindings.permissionKind.Microphone, PermissionKind.microphone],
    [bindings.permissionKind.Camera, PermissionKind.camera]
  ]);
  const permissionStates = new Map<PermissionDecision, ValueOf<typeof bindings.permissionState>>([
    [PermissionDecision.allow, bindings.permissionState.Allow],
    [PermissionDecision.deny, bindings.permissionState.Deny],
    [PermissionDecision.default, bindings.permissionState.Default]
  ]);

  return {
    onMessage(listener) {
      core.onWebMessageReceived((_sender, args) => listener(args.webMessageAsJson));
    },
    onProcessFailed(listener) {
      core.onProcessFailed((_sender, args) => {
        const isBrowserDead = args.processFailedKind === bindings.failedKind.BrowserProcessExited;
        listener(isBrowserDead ? ProcessFailureKind.browserExited : ProcessFailureKind.other);
      });
    },
    onPermission(decide) {
      core.onPermissionRequested((_sender, args) => {
        const decision = decide(permissionKinds.get(args.permissionKind) ?? PermissionKind.other);
        const isDefault = decision === PermissionDecision.default;
        if (isDefault) {
          return;
        }

        args.state = permissionStates.get(decision) ?? bindings.permissionState.Default;
        args.handled = true;
      });
    },
    onNavigation(isAllowed) {
      core.onNavigationStarting((_sender, args) => {
        const isRefused = !isAllowed(args.uri);
        if (isRefused) {
          args.cancel = true;
        }
      });
    }
  } satisfies Pick<WebViewCore, "onMessage" | "onProcessFailed" | "onPermission" | "onNavigation">;
}

function bindActions({ core, environment, bindings, log }: {
  core: Core;
  environment: Environment;
  bindings: Bindings;
  log: Logger;
}) {
  const setCookie = createCookieWriter({
    core,
    bindings,
    log
  });

  return {
    navigate: url => core.navigate(url),
    reload: () => core.reload(),
    postMessage: json => core.postWebMessageAsJson(json),
    async injectScript(code) {
      await core.addScriptToExecuteOnDocumentCreatedAsync(code);
    },
    blockRequests(filter) {
      core.addWebResourceRequestedFilter(filter, bindings.resourceContext.All);
      core.onWebResourceRequested((_sender, args) => {
        args.response = environment.createWebResourceResponse(
          new bindings.streamClass(),
          NO_CONTENT,
          "No Content",
          ""
        );
      });
    },
    setCookies(cookies) {
      for (const cookie of cookies) {
        setCookie(cookie);
      }
    },
    async callDevTools({ method, params }) {
      await core.callDevToolsProtocolMethodAsync(method, JSON.stringify(params));
    }
  } satisfies Omit<WebViewCore, "source" | "onMessage" | "onProcessFailed" | "onPermission" | "onNavigation">;
}

async function logDebugPort({ spec, log }: {
  spec: WindowSpec;
  log: Logger;
}) {
  try {
    const file = path.join(spec.profileDir, "EBWebView", "DevToolsActivePort");
    const [port] = (await readFile(file, "utf8")).split(/\r?\n/);
    log.write(`${spec.logTag}: devtools on localhost:${port}`);
  } catch (error) {
    log.write(`${spec.logTag}: devtools port unknown: ${errorMessage(error)}`);
  }
}

function closeWindow({ window, spec, log }: {
  window: AppWindow<object> | undefined;
  spec: WindowSpec;
  log: Logger;
}) {
  try {
    window?.close();
  } catch (error) {
    log.write(`${spec.logTag}: closing the crashed window: ${errorMessage(error)}`);
  }
}

function openParkedWindow({ bindings, control, spec, log }: {
  bindings: Bindings;
  control: InstanceType<Bindings["webViewClass"]>;
  spec: WindowSpec;
  log: Logger;
}) {
  const host = bindings.createWindow({
    control,
    title: spec.title,
    size: {
      width: spec.width,
      height: spec.height
    },
    isToolWindow: true,
    isActivatable: false,
    isShownInSwitchers: false
  });
  host.window.appWindow.moveAndResize({
    x: PARKED_AT,
    y: PARKED_AT,
    width: spec.width,
    height: spec.height
  });
  // Task Manager or the window list can ask the parked window to close; it stays, as GoogleWebViewHost.cs
  // cancels Closing. Closing it from code (a crashed control's replacement) does not raise this.
  host.window.appWindow.onClosing((_sender, event) => {
    event.cancel = true;
    log.write(`${spec.logTag}: the parked window was asked to close; kept`);
  });
  return host;
}

// Builds the hidden WebView2 for one host over winui-svelte's generated bindings. The control lives
// in a shown, tool-style, non-activatable window parked off-screen: shown, because a hidden or
// occluded Chromium window throttles its page; parked and tool-style, so nobody sees it or finds
// it in Alt+Tab. Every create() replaces the previous window.
//
// Unproven without a desktop session: that such a window keeps Chromium's page at full speed, that
// the environment's folder and flags reach the browser, that an empty response stops
// RotateCookies, and that a rebuilt control starts cleanly after a browser crash.
export function createWinUiWebViewFactory({ spec, log }: {
  spec: WindowSpec;
  log: Logger;
}) {
  let previous: AppWindow<object> | undefined;

  async function create({ isDebugging }: WebViewOptions) {
    const bindings = await loadBindings();
    // A browser-process crash leaves the old control permanently invalid; drop its window
    closeWindow({
      window: previous,
      spec,
      log
    });

    const control = new bindings.webViewClass();
    const host = openParkedWindow({
      bindings,
      control,
      spec,
      log
    });
    previous = host;

    const options = bindings.optionsClass.create();
    options.additionalBrowserArguments = CHROMIUM_ARGUMENTS + (isDebugging ? DEBUG_ARGUMENT : "");
    const environment = await bindings.environmentClass.createWithOptionsAsync("", spec.profileDir, options);
    await control.ensureCoreWebView2Async(environment);
    const core = control.coreWebView2;
    core.settings.areDevToolsEnabled = isDebugging;
    core.settings.isStatusBarEnabled = false;

    if (isDebugging) {
      void logDebugPort({
        spec,
        log
      });
    }

    const webView: WebViewCore = {
      get source() {
        return core.source;
      },
      ...bindEvents({
        core,
        bindings
      }),
      ...bindActions({
        core,
        environment,
        bindings,
        log
      })
    };
    return webView;
  }

  return { create };
}
