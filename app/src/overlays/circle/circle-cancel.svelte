<script lang="ts">
  import { OverlayGlyph } from "@/overlays/glyphs.ts";
  import { CircleKeyCombination, keyName } from "@/overlays/window/hotkeys.ts";
  import { Button, TextBlock } from "winui-svelte/components";

  interface Props {
    onpress: () => void;
  }

  const { onpress }: Props = $props();

  const CANCEL_LABEL = "Cancel Circle to Search";
</script>

<!-- Closes the overlay and drops the selection; Gemini's session and what it sees stay as they are -->
<Button
  class="circle-action circle-round"
  automationName={CANCEL_LABEL}
  onclick={onpress}
  toolTip="{CANCEL_LABEL} ({keyName(CircleKeyCombination.escape)})"
>
  <TextBlock class="circle-cancel-icon" text={OverlayGlyph.close} />
</Button>

<style>
  .circle-cancel-icon {
    font-family: "Material Symbols Rounded";
    font-size: 18px;
  }
</style>
