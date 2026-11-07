import type { Settings } from "@/core/settings/settings-file.ts";
import { apiKey, saveSettings, setApiKey } from "@/core/settings/settings.ts";
import type { SettingsPort } from "@/pill/ports.ts";
import type { EngineKind } from "@gemini-live/protocol/view";

// The pill's view of the loaded settings: reads the live object, saves after each change
export function createSettingsPort(settings: Settings) {
  const port: SettingsPort = {
    get engine() {
      return settings.engine;
    },
    get microphoneId() {
      return settings.microphoneId;
    },
    get hasApiKey() {
      return apiKey(settings).length > 0;
    },
    get isAutoUpdateOn() {
      return settings.checkForUpdates;
    },
    setEngine(kind: EngineKind) {
      settings.engine = kind;
      return saveSettings(settings);
    },
    setMicrophoneId(id: string | null) {
      settings.microphoneId = id;
      return saveSettings(settings);
    },
    setApiKey(key: string) {
      return setApiKey({
        settings,
        key
      });
    },
    setAutoUpdate(isOn: boolean) {
      settings.checkForUpdates = isOn;
      return saveSettings(settings);
    }
  };
  return port;
}
