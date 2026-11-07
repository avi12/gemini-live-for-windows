<script lang="ts">
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { GlyphButtonKind } from "@/ui/glyph-button.ts";
  import GlyphButton from "@/ui/GlyphButton.svelte";
  import { Glyph } from "@/ui/glyphs.ts";
  import DisplayMenu from "@/ui/menu/DisplayMenu.svelte";
  import GearMenu from "@/ui/menu/GearMenu.svelte";
  import { Motion } from "@/ui/motion.ts";
  import { PillPart, trackPart } from "@/ui/places.svelte.ts";
  import { PillActionKind } from "@gemini-live/protocol/view";
  import { fade } from "svelte/transition";
  import { TextBlock } from "winui-svelte/components";

  const MIN_DISPLAYS_TO_PICK = 2;
  const PillColumn = {
    share: 0,
    mic: 1,
    status: 2,
    gear: 3,
    end: 4
  } as const;
  const SHARE_GLYPH_SIZE = 20;
  const ROUND_GLYPH_SIZE = 24;

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

  const isDetailEmpty = $derived(view.statusDetail === "");

  const statusDetail = $derived.by(() => {
    if (isDetailEmpty) {
      return undefined;
    }

    return view.statusDetail;
  });

  const shareToolTip = $derived.by(() => {
    const isSharedKnown = hasDisplayPicker && view.sharedDisplayName !== null;
    if (isSharedKnown) {
      return `Sharing ${view.sharedDisplayName} • click to change`;
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
    glyphSize={SHARE_GLYPH_SIZE}
    hasChevron={hasDisplayPicker}
    isHitTestVisible={hasDisplayPicker}
    kind={GlyphButtonKind.share}
    label="Share"
    part={PillPart.share}
    toolTip={shareToolTip}
  />
  <GlyphButton
    column={PillColumn.mic}
    glyph={mic.glyph}
    glyphSize={ROUND_GLYPH_SIZE}
    isMuted={view.isMuted}
    isSpaced
    kind={GlyphButtonKind.round}
    label={mic.label}
    onpress={() => sendAction({ kind: PillActionKind.mute })}
    part={PillPart.mic}
    toolTip={mic.label}
  />

  <grid class="status" toolTip={statusDetail}>
    {#key view.status}
      <border
        in:fade={{ duration: Motion.standardMilliseconds }}
        out:fade={{ duration: Motion.swapOutMilliseconds }}
      >
        <TextBlock class="live-supporting-text" textTrimming="CharacterEllipsis">{view.status}</TextBlock>
      </border>
    {/key}
  </grid>

  <GlyphButton
    column={PillColumn.gear}
    flyout={gearFlyout}
    glyph={Glyph.gear}
    glyphSize={ROUND_GLYPH_SIZE}
    kind={GlyphButtonKind.round}
    label="Settings"
    part={PillPart.gear}
    toolTip="Settings"
  />
  <GlyphButton
    column={PillColumn.end}
    glyph={Glyph.close}
    glyphSize={ROUND_GLYPH_SIZE}
    isSpaced
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
    grid-template-columns: auto auto 1fr auto auto;
    height: 68px;
    padding: 0 12px;
  }

  .status {
    grid-column: 3;
    align-self: center;
    margin: 0 14px;
  }
</style>
