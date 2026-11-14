<script lang="ts">
  import { createCookieWriter } from "@/google/web-host/winui-web-view.ts";
  import { errorMessage } from "@/lib/error-message.ts";
  import { dataDir } from "@/lib/paths.ts";
  import { OverlayGlyph } from "@/overlays/glyphs.ts";
  import type { ResultsTarget } from "@/overlays/results/results-layout.ts";
  import { isRightToLeft, panelBounds, systemLocale } from "@/overlays/results/results-layout.ts";
  import { windowTheme } from "@/overlays/window/window-theme.svelte.ts";
  import "@gemini-live/pill/theme.css";
  import type { BrowserCookie } from "@gemini-live/protocol/link";
  import path from "node:path";
  import { projectAs } from "winui-svelte/bindings/lifetime";
  import { WebView2 as WebView2Element } from "winui-svelte/bindings/microsoft/ui/xaml/controls/WebView2";
  import {
    CoreWebView2CookieSameSiteKind
  } from "winui-svelte/bindings/microsoft/web/web-view2/core/CoreWebView2CookieSameSiteKind";
  import {
    Button,
    Grid,
    StackPanel,
    TextBlock,
    WebView2,
    Window
  } from "winui-svelte/components";
  import type { WindowHandle } from "winui-svelte/components";
  import { createWebView2Environment, startWebView2 } from "winui-svelte/messaging/web-view2";

  interface Props {
    // The page to show and the display it docks to; undefined hides the panel
    target: ResultsTarget | undefined;
    // The Google account's cookies, from the extension's saved session
    loadCookies: () => Promise<readonly BrowserCookie[]>;
    // Opens the address the panel shows in the user's default browser
    onopenbrowser: (url: string) => void;
    // Puts the address the panel shows on the clipboard
    oncopyurl: (url: string) => void;
    ondismissed: () => void;
    onfailed: (message: string) => void;
  }

  const { target, loadCookies, onopenbrowser, oncopyurl, ondismissed, onfailed }: Props = $props();

  const TITLE = "Google";
  const BUTTON_GAP = 8;
  const COPY_TOOL_TIP = "Copy the address";
  const OPEN_TOOL_TIP = "Open in your browser";
  // The page is shown the way a phone gets it: narrow results, the touch layout
  const MOBILE_USER_AGENT = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) "
    + "Chrome/141.0.0.0 Mobile Safari/537.36";
  const CLOSE_TOOL_TIP = "Close";
  const PROFILE = "WebViewResults";

  const windowRef: { handle: WindowHandle | undefined } = $state({ handle: undefined });
  // The page the panel is on now, which the browser button opens, and whether the account's cookies
  // are in place so the page may load
  const page: {
    url: string | undefined;
    isReady: boolean;
  } = $state({
    url: undefined,
    isReady: false
  });
  const web: { control: WebView2Element | undefined } = $state({ control: undefined });
  const theme = windowTheme();

  function place() {
    const handle = windowRef.handle;
    const isPending = target === undefined || handle === undefined;
    if (isPending) {
      return;
    }

    handle.appWindow.moveAndResize(
      panelBounds({
        monitor: target.monitor,
        scale: handle.scale,
        isRtl: isRightToLeft(systemLocale())
      })
    );
  }

  $effect(() => {
    void target;
    void windowRef.handle;
    place();
  });

  // The address the buttons act on; nothing happens before a page is open
  function withPage(act: (url: string) => void) {
    return () => {
      const url = page.url;
      const hasPage = url !== undefined;
      if (hasPage) {
        act(url);
      }
    };
  }

  async function signIn(core: Parameters<typeof createCookieWriter>[0]["core"]) {
    core.settings.userAgent = MOBILE_USER_AGENT;
    const setCookie = createCookieWriter({
      core,
      bindings: {
        sameSiteKind: CoreWebView2CookieSameSiteKind
      },
      log: {
        write: onfailed
      }
    });
    for (const cookie of await loadCookies()) {
      setCookie(cookie);
    }

    page.isReady = true;
  }

  // One browser process runs per profile folder, so the panel gets its own: sharing the default one
  // with the Gemini page's WebView2 stopped that page from starting
  async function start(control: WebView2Element) {
    try {
      const environment = await createWebView2Environment({ userDataFolder: path.join(dataDir(), PROFILE) });
      await startWebView2({
        control,
        environment
      });
      await signIn(control.coreWebView2);
      web.control = control;
    } catch (error) {
      onfailed(errorMessage(error));
    }
  }

  // The page loads only once the cookies are in: the first request must already be signed in. It is
  // navigated to rather than set as `source`, which would start the control in the default profile.
  $effect(() => {
    const url = target?.url;
    const control = web.control;
    const isLoadable = url !== undefined && page.isReady && control !== undefined;
    if (!isLoadable) {
      return;
    }

    page.url = url;
    control.coreWebView2.navigate(url);
  });
</script>

<Window
  activate={false}
  isAlwaysOnTop
  isBorderless
  isHidden={target === undefined}
  isResizable={false}
  isShownInSwitchers={false}
  isToolWindow
  onscalechanged={place}
  theme={theme.current}
  title="Google results"
  bind:handle={() => windowRef.handle, handle => {
    windowRef.handle = handle;
  }}
>
  <Grid class="results-panel">
    <Grid class="results-header" gridRow={0}>
      <TextBlock class="results-title" text={TITLE} verticalAlignment="Center" />
      <StackPanel gridColumn={1} orientation="Horizontal" spacing={BUTTON_GAP}>
        <Button class="circle-action circle-round" onclick={withPage(oncopyurl)} toolTip={COPY_TOOL_TIP}>
          <TextBlock class="circle-icon results-icon" text={OverlayGlyph.copy} />
        </Button>
        <Button class="circle-action circle-round" onclick={withPage(onopenbrowser)} toolTip={OPEN_TOOL_TIP}>
          <TextBlock class="circle-icon results-icon" text={OverlayGlyph.openInBrowser} />
        </Button>
        <Button class="circle-action circle-round" onclick={ondismissed} toolTip={CLOSE_TOOL_TIP}>
          <TextBlock class="circle-icon results-icon" text={OverlayGlyph.close} />
        </Button>
      </StackPanel>
    </Grid>
    <WebView2
      gridRow={1}
      onloaded={sender => void start(projectAs(sender, WebView2Element))}
      onnavigationstarting={(_, args) => {
        page.url = args.uri;
      }}
    />
  </Grid>
</Window>

<style>
  .results-panel {
    display: grid;
    grid-template-rows: auto 1fr;
  }

  .results-header {
    display: grid;
    grid-template-columns: 1fr auto;
    padding-block: 8px;
    padding-inline: 0 12px;
  }

  .results-title {
    margin-left: 16px;
    font-weight: 600;
    font-size: 16px;
  }

  .results-icon {
    font-family: "Material Symbols Rounded";
    font-size: 20px;
  }
</style>
