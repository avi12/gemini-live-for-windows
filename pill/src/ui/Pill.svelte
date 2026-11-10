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
    share: 0,
    middle: 1,
    mic: 2,
    gear: 3,
    end: 4
  } as const;
  const GLYPH_SIZE = 24;

  const hasDisplayPicker = $derived(view.displays.length >= MIN_DISPLAYS_TO_PICK);

  const mic = $derived.by(() => {
    if (view.isMuted) {
      return {
        glyph: Glyph.micOff,
        label: "Unmute microphone"
      };
    }

    return {
      glyph: Glyph.mic,
      label: "Mute microphone"
    };
  });

  const isListening = $derived(view.status === LiveStatus.listening);
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

<grid class="live-pill pill" {@attach trackPart(PillPart.pill)}>
  <GlyphButton
    column={PillColumn.share}
    flyout={shareFlyout}
    glyph={Glyph.display}
    glyphSize={GLYPH_SIZE}
    isHitTestVisible={hasDisplayPicker}
    kind={GlyphButtonKind.round}
    label="Share"
    part={PillPart.share}
    toolTip={shareToolTip}
  />

  <grid class="middle" toolTip={statusDetail}>
    {#key middleKey}
      <border
        in:fade={{ duration: Motion.standardMilliseconds }}
        out:fade={{ duration: Motion.swapOutMilliseconds }}
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
    column={PillColumn.mic}
    glyph={mic.glyph}
    glyphSize={GLYPH_SIZE}
    isMuted={view.isMuted}
    kind={GlyphButtonKind.accent}
    label={mic.label}
    onpress={() => sendAction({ kind: PillActionKind.mute })}
    part={PillPart.mic}
    toolTip={mic.label}
  />
  <GlyphButton
    column={PillColumn.gear}
    flyout={gearFlyout}
    glyph={Glyph.gear}
    glyphSize={GLYPH_SIZE}
    kind={GlyphButtonKind.round}
    label="Settings"
    part={PillPart.gear}
    toolTip="Settings"
  />
  <GlyphButton
    column={PillColumn.end}
    glyph={Glyph.close}
    glyphSize={GLYPH_SIZE}
    kind={GlyphButtonKind.round}
    label="End (Win+C)"
    onpress={() => sendAction({ kind: PillActionKind.end })}
    part={PillPart.end}
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
