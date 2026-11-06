<script lang="ts">
  import { sendAction } from "@/lib/view.svelte.ts";
  import { PillActionKind } from "@/protocol/view.ts";
  import { elementRef, focusElement } from "winui-svelte";
  import { projectAs } from "winui-svelte/bindings/lifetime";
  import { KeyRoutedEventArgs } from "winui-svelte/bindings/microsoft/ui/xaml/input/KeyRoutedEventArgs";
  import { Hyperlink, PasswordBox, StackPanel, TextBlock } from "winui-svelte/components";
  import { VirtualKey } from "winui-svelte/enums";

  type FocusableControl = Parameters<typeof focusElement>[0]["control"];

  const FOCUS_TRIES = 20;
  const FOCUS_RETRY_MILLISECONDS = 50;
  const API_KEY_PAGE = "https://aistudio.google.com/apikey";

  const box = elementRef<FocusableControl>();
  let key = $state("");

  $effect(() => {
    sendAction({
      kind: PillActionKind.setFocusable,
      isFocusable: true
    });
  });

  $effect(() => {
    const { current } = box;
    const isBoxMissing = current === undefined;
    if (isBoxMissing) {
      return;
    }

    let triesLeft = FOCUS_TRIES;
    const timer = setInterval(() => {
      triesLeft--;
      const isFocused = focusElement({ control: current });
      const isDone = isFocused || triesLeft <= 0;
      if (isDone) {
        clearInterval(timer);
      }
    }, FOCUS_RETRY_MILLISECONDS);
    return () => clearInterval(timer);
  });

  function onKeyDown(args: object) {
    const event = projectAs(args, KeyRoutedEventArgs);
    const isEscape = event.key === VirtualKey.Escape;
    if (isEscape) {
      event.handled = true;
      key = "";
      sendAction({ kind: PillActionKind.cancelKey });
      return;
    }

    const isSubmit = event.key === VirtualKey.Enter && key.trim().length > 0;
    if (!isSubmit) {
      return;
    }

    event.handled = true;
    sendAction({
      kind: PillActionKind.submitKey,
      key: key.trim()
    });
    key = "";
  }
</script>

<StackPanel class="key-panel">
  <TextBlock class="live-supporting-text" textWrapping="Wrap">
    Paste a Gemini API key (free at
    <Hyperlink
      onclick={() => sendAction({
        kind: PillActionKind.openLink,
        uri: API_KEY_PAGE
      })}>aistudio.google.com/apikey</Hyperlink>), then press Enter. Esc goes back.
  </TextBlock>
  <PasswordBox
    {@attach box.attach}
    onkeydown={(_sender, args) => onKeyDown(args)}
    bind:password={key}
  />
</StackPanel>

<style>
  .key-panel {
    gap: 8px;
    margin-top: 4px;
  }
</style>
