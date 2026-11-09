import { systemSettings, WindowTheme } from "winui-svelte/window";

// A packaged window with no theme of its own paints an opaque white fill under its transparent
// backdrop, so every overlay names the theme of the system. Call it while a component initialises.
export function windowTheme() {
  const settings = systemSettings();
  return {
    get current() {
      return settings.isDarkTheme ? WindowTheme.dark : WindowTheme.light;
    }
  };
}
