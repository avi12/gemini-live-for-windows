<script lang="ts">
  import { findSharedDisplayName } from "@/lib/display-labels.ts";
  import { sendAction, view } from "@/lib/view.svelte.ts";
  import { collapse, PILL_WIDTH, toggleCollapse } from "@/ui/fold/collapse.svelte.ts";
  import { foldPathData } from "@/ui/glyph/morph/fold-icon.ts";
  import { micPathData } from "@/ui/glyph/morph/mic-icon.ts";
  import MorphIcon from "@/ui/glyph/morph/MorphIcon.svelte";
  import { GlyphButtonKind } from "@/ui/glyph/glyph-button.ts";
  import GlyphButton from "@/ui/glyph/GlyphButton.svelte";
  import { Glyph } from "@/ui/glyph/glyphs.ts";
  import DisplayMenu from "@/ui/menu/DisplayMenu.svelte";
  import GearMenu from "@/ui/menu/gear/GearMenu.svelte";
  import { Motion } from "@/ui/motion/motion.ts";
  import { PillPart, trackPart } from "@/ui/window/places.svelte.ts";
  import Waveform from "@/ui/pill/Waveform.svelte";
  import { LiveStatus, PillActionKind } from "@gemini-live/protocol/view";
  import { fade } from "svelte/transition";
  import { Path, TextBlock } from "winui-svelte/components";

  const MIN_DISPLAYS_TO_PICK = 2;
  const GLYPH_SIZE = 24;
  const MUTED_BADGE_ICON_SIZE = 14;

  const foldLabel = $derived.by(() => {
    if (collapse.isCollapsed) {
      return "Expand";
    }

    return "Collapse";
  });

  const hasDisplayPicker =$derived(view.displays.length >= MIN_DISPLAYS_TO_PICK);

  const micLabel = $derived.by(() => {
    if (view.isMuted) {
      return "Unmute microphone";
    }

    return "Mute microphone";
  });

  const micFill = $derived.by(() => {
    if (view.isMuted) {
      return "live-path-muted";
    }

    return "live-path-accent";
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

{#snippet middle()}
  <grid class="middle" toolTip={statusDetail}>
    {#key middleKey}
      <border
        class="status"
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
{/snippet}

{#snippet micButton(column: number)}
  <GlyphButton
    {column}
    glyphSize={GLYPH_SIZE}
    isMuted={view.isMuted}
    kind={GlyphButtonKind.ACCENT}
    label={micLabel}
    onpress={() => sendAction({ kind: PillActionKind.MUTE })}
    part={PillPart.MIC}
    toolTip={micLabel}
  >
    {#snippet icon()}
      <MorphIcon class={micFill} isSecond={view.isMuted} pathData={micPathData} size={GLYPH_SIZE} />
    {/snippet}
  </GlyphButton>
{/snippet}

{#snippet foldButton(column: number)}
  <GlyphButton
    {column}
    glyphSize={GLYPH_SIZE}
    kind={GlyphButtonKind.ROUND}
    label={foldLabel}
    onpress={toggleCollapse}
    part={PillPart.COLLAPSE}
    toolTip={foldLabel}
  >
    {#snippet icon()}
      <MorphIcon
        class="live-path-round"
        isSecond={collapse.isCollapsed}
        pathData={foldPathData}
        size={GLYPH_SIZE}
      />
    {/snippet}
  </GlyphButton>
{/snippet}

<!-- The capsule takes the size of whichever face shows. Both faces stay built and the hidden one leaves
     the layout (display: none): rebuilding the buttons on each fold cost a tenth of a second of the UI
     thread, mid-glide. The face that comes in fades in. -->
<grid
  class="live-pill pill"
  {@attach trackPart(PillPart.PILL)}
>
  <grid class="face folded" class:live-face-hidden={!collapse.isCollapsed} class:live-face-shown={collapse.isCollapsed}>
    <border class="orb"></border>
  </grid>
  <grid style:width="{PILL_WIDTH}px" class="face unfolded" class:live-face-hidden={collapse.isCollapsed} class:live-face-shown={!collapse.isCollapsed}>
    <GlyphButton
      column={0}
      flyout={shareFlyout}
      glyph={Glyph.DISPLAY}
      glyphSize={GLYPH_SIZE}
      isHitTestVisible={hasDisplayPicker}
      kind={GlyphButtonKind.ROUND}
      label="Share"
      part={PillPart.SHARE}
      toolTip={shareToolTip}
    />
    {@render middle()}
    {@render micButton(2)}
    <GlyphButton
      column={3}
      flyout={gearFlyout}
      glyph={Glyph.GEAR}
      glyphSize={GLYPH_SIZE}
      kind={GlyphButtonKind.ROUND}
      label="Settings"
      part={PillPart.GEAR}
      toolTip="Settings"
    />
    <GlyphButton
      column={4}
      glyph={Glyph.CLOSE}
      glyphSize={GLYPH_SIZE}
      kind={GlyphButtonKind.ROUND}
      label="End (Win+C)"
      onpress={() => sendAction({ kind: PillActionKind.END })}
      part={PillPart.END}
      toolTip="End (Win+C)"
    />
    <border class="fold-room"></border>
  </grid>
  <!-- One button for both forms, so its icon can glide from one to the other: inside either face it
       would be rebuilt by the swap and start at its end shape -->
  <grid class="fold">
    {@render foldButton(0)}
    {#if collapse.isCollapsed && view.isMuted}
      <grid
        class="live-muted-fill muted-badge"
        isHitTestVisible={false}
        transition:fade={{ duration: Motion.STANDARD_MILLISECONDS }}
      >
        <Path
          class="live-path-muted badge-icon"
          data={micPathData({ progress: 1, size: MUTED_BADGE_ICON_SIZE })}
          height={MUTED_BADGE_ICON_SIZE}
          width={MUTED_BADGE_ICON_SIZE}
        />
      </grid>
    {/if}
  </grid>
</grid>

<style>
  .pill {
    display: grid;
    height: 76px;
  }

  /* Kept to the capsule's right end while it is narrower than the contents (mid-glide), so the fold
     button stays under the pointer and the rest is uncovered from the left as the capsule grows */
  .face {
    justify-self: end;
    padding: 0 18px;
    column-gap: 12px;
  }

  .unfolded {
    grid-template-columns: auto 1fr auto auto auto auto;
  }

  /* As wide as the capsule is tall, which makes it a circle */
  .folded {
    grid-template-columns: 1fr;
    min-width: 76px;
  }

  /* The room the fold button takes, which is as wide as the button; pinned to the right end, so it
     stays put while the capsule narrows around it */
  .orb,
  .fold-room {
    align-self: center;
    justify-self: end;
    width: 40px;
    height: 40px;
  }

  .fold-room {
    grid-column: 6;
  }

  /* On the capsule's right end, over whichever face shows, at the same place in both */
  .fold {
    align-self: center;
    justify-self: end;
    margin-right: 18px;
  }

  /* The orb has no mic button to show the mute, so a small badge on its corner does */
  .muted-badge {
    align-self: start;
    justify-self: start;
    width: 22px;
    height: 22px;
    margin-top: -8px;
    margin-left: -8px;
    border-radius: 11px;
  }

  .badge-icon {
    align-self: center;
    justify-self: center;
  }

  .middle {
    grid-column: 2;
    align-self: center;
  }

  .status {
    justify-self: center;
  }
</style>
