<script lang="ts">
  import { OverlayGlyph } from "@/overlays/glyphs.ts";
  import { Button, TextBlock } from "winui-svelte/components";

  interface Props {
    onpress: () => void;
  }

  const { onpress }: Props = $props();

  const CANCEL_LABEL = "Cancel Circle to Search";
</script>

<!-- Closes the overlay and drops the selection; Gemini's session and what it sees stay as they are -->
<Button
  class="circle-action circle-cancel"
  automationName={CANCEL_LABEL}
  onclick={onpress}
  toolTip="{CANCEL_LABEL} (Esc)"
>
  <TextBlock class="circle-cancel-icon" text={OverlayGlyph.close} />
</Button>

<style>
  .circle-cancel {
    width: 48px;
    height: 48px;
    padding: 0;
    border-width: 0;
    border-radius: 24px;
  }

  .circle-cancel-icon {
    font-family: "Material Symbols Rounded";
    font-size: 18px;
  }
</style>
