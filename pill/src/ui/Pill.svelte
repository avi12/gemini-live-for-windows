<script lang="ts">
  import { findSharedDisplayName } from "@/lib/display-labels.ts";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { GlyphButtonKind } from "@/ui/glyph/glyph-button.ts";
  import GlyphButton from "@/ui/glyph/GlyphButton.svelte";
  import { Glyph } from "@/ui/glyph/glyphs.ts";
  import DisplayMenu from "@/ui/menu/DisplayMenu.svelte";
  import GearMenu from "@/ui/menu/GearMenu.svelte";
  import { Motion } from "@/ui/motion/motion.ts";
  import { PillPart, trackPart } from "@/ui/places.svelte.ts";
  import Waveform from "@/ui/Waveform.svelte";
  import { LiveStatus, PillActionKind } from "@gemini-live/protocol/view";
  import { fade } from "svelte/transition";
  import { TextBlock } from "winui-svelte/components";

  const MIN_DISPLAYS_TO_PICK = 2;
  const PillColumn = {
    SHARE: 0,
    MIDDLE: 1,
    MIC: 2,
    GEAR: 3,
    END: 4
  } as const;
  const GLYPH_SIZE = 24;

  const hasDisplayPicker = $derived(view.displays.length >= MIN_DISPLAYS_TO_PICK);

  const mic = $derived.by(() => {
    if (view.isMuted) {
      return {
        glyph: Glyph.MIC_OFF,
        label: "Unmute microphone"
      };
    }

    return {
      glyph: Glyph.MIC,
      label: "Mute microphone"
    };
  });

  const isListening = $derived(view.status === LiveStatus.LISTENING);
  const middleKey = $derived(isListening ? "waveform" : view.status);
  const isDetailEmpty = $derived(view.statusDetail === "");

  const statusDetail = $derived.by(() => {
    if (isDetailEmpty) {
      return undefined;
    }

    return view.statusDetail;
  });

  const sharedDisplayName = $derived(
    findSharedDisplayName({
      displays: view.displays,
      sharedDisplayId: view.sharedDisplay
    })
  );

  const shareToolTip = $derived.by(() => {
    const isSharedKnown = hasDisplayPicker && sharedDisplayName !== null;
    if (isSharedKnown) {
      return `Sharing ${sharedDisplayName} • click to change`;
    }

    return "Gemini sees your screen";
  });

  const shareFlyout = $derived.by(() => {
    if (hasDisplayPicker) {
      return displayFlyout;
    }

    return undefined;
  });
</script>

{#snippet displayFlyout()}
  <DisplayMenu />
{/snippet}

{#snippet gearFlyout()}
  <GearMenu />
{/snippet}

<grid class="live-pill pill" {@attach trackPart(PillPart.PILL)}>
  <GlyphButton
    column={PillColumn.SHARE}
    flyout={shareFlyout}
    glyph={Glyph.DISPLAY}
    glyphSize={GLYPH_SIZE}
    isHitTestVisible={hasDisplayPicker}
    kind={GlyphButtonKind.ROUND}
    label="Share"
    part={PillPart.SHARE}
    toolTip={shareToolTip}
  />

  <grid class="middle" toolTip={statusDetail}>
    {#key middleKey}
      <border
        in:fade={{ duration: Motion.STANDARD_MILLISECONDS }}
        out:fade={{ duration: Motion.SWAP_OUT_MILLISECONDS }}
      >
        {#if isListening}
          <Waveform />
        {:else}
          <TextBlock class="live-supporting-text" textTrimming="CharacterEllipsis">{view.status}</TextBlock>
        {/if}
      </border>
    {/key}
  </grid>

  <GlyphButton
    column={PillColumn.MIC}
    glyph={mic.glyph}
    glyphSize={GLYPH_SIZE}
    isMuted={view.isMuted}
    kind={GlyphButtonKind.ACCENT}
    label={mic.label}
    onpress={() => sendAction({ kind: PillActionKind.MUTE })}
    part={PillPart.MIC}
    toolTip={mic.label}
  />
  <GlyphButton
    column={PillColumn.GEAR}
    flyout={gearFlyout}
    glyph={Glyph.GEAR}
    glyphSize={GLYPH_SIZE}
    kind={GlyphButtonKind.ROUND}
    label="Settings"
    part={PillPart.GEAR}
    toolTip="Settings"
  />
  <GlyphButton
    column={PillColumn.END}
    glyph={Glyph.CLOSE}
    glyphSize={GLYPH_SIZE}
    kind={GlyphButtonKind.ROUND}
    label="End (Win+C)"
    onpress={() => sendAction({ kind: PillActionKind.END })}
    part={PillPart.END}
    toolTip="End (Win+C)"
  />
</grid>

<style>
  .pill {
    display: grid;
    grid-template-columns: auto 1fr auto auto auto;
    height: 76px;
    padding: 0 18px;
    column-gap: 12px;
  }

  .middle {
    grid-column: 2;
    justify-items: center;
    align-self: center;
  }
</style>
