import { tick } from "svelte";

/**
 * A count that goes up each time the system theme flips, to key the window's content on. WinUI leaves
 * controls that already exist on the old theme's colors when the theme flips, so the content is
 * rebuilt once the window has taken the new theme. The tick waits for that: a rebuild in the same pass
 * would resolve its colors against the old theme again. Call it while a component initializes.
 *
 * @param isDarkTheme - Reads whether the system theme is dark.
 * @returns The current count, as a getter.
 */
export function themeRebuilds(isDarkTheme: () => boolean) {
  let epoch = $state(0);
  let shownTheme = isDarkTheme();
  $effect(() => {
    const isDark = isDarkTheme();
    if (isDark === shownTheme) {
      return;
    }

    shownTheme = isDark;
    void tick().then(() => {
      epoch += 1;
    });
  });

  return {
    get epoch() {
      return epoch;
    }
  };
}
