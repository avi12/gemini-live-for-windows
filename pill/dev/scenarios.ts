import { EngineKind, GlowMode, pillViewSchema } from "@gemini-live/protocol/view";
import type { PillView } from "@gemini-live/protocol/view";

export const ScenarioName = {
  idle: "idle",
  captions: "captions",
  gearMenu: "gearMenu",
  displayMenu: "displayMenu",
  keyPrompt: "keyPrompt",
  updateAvailable: "updateAvailable",
  cameraShared: "cameraShared"
} as const;

export type ScenarioName = (typeof ScenarioName)[keyof typeof ScenarioName];

export const SCENARIO_ORDER = Object.values(ScenarioName);

const MONITORS = [
  {
    id: "\\\\.\\DISPLAY1",
    name: "Display 1 (primary)",
    refreshRateHertz: 60,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080
  },
  {
    id: "\\\\.\\DISPLAY2",
    name: "Display 2",
    refreshRateHertz: 120,
    x: 1920,
    y: 0,
    width: 2560,
    height: 1440
  }
];

const MICROPHONES = [
  {
    id: "mic-headset",
    name: "Headset microphone"
  },
  {
    id: "mic-array",
    name: "Microphone array"
  }
];

const IDLE: PillView = {
  status: "Listening",
  statusDetail: "",
  isMuted: false,
  lines: [],
  links: [],
  displays: MONITORS,
  pillDisplay: MONITORS[0]?.id ?? null,
  sharedDisplay: null,
  sharedDisplayName: null,
  isExtensionNeeded: false,
  isExtensionStepsShown: false,
  isKeyPromptShown: false,
  engine: EngineKind.google,
  microphones: MICROPHONES,
  microphoneId: "mic-headset",
  isCameraAvailable: true,
  isCameraShared: false,
  update: null,
  glow: {
    mode: GlowMode.breathe,
    level: 0,
    isUser: false
  },
  isShown: true,
  isFocusable: false
};

const CAPTIONS: PillView = {
  ...IDLE,
  lines: [
    {
      id: "line-1",
      text: "What is the tallest building in the world?",
      isUser: true,
      isNote: false
    },
    {
      id: "line-2",
      text: "The Burj Khalifa in Dubai, at 828 meters. Here is where to read more.",
      isUser: false,
      isNote: false
    }
  ],
  links: [
    {
      id: "link-1",
      title: "Burj Khalifa",
      uri: "https://en.wikipedia.org/wiki/Burj_Khalifa",
      address: "en.wikipedia.org",
      isSearch: false
    },
    {
      id: "link-2",
      title: "tallest buildings",
      uri: "https://www.google.com/search?q=tallest+buildings",
      address: "google.com",
      isSearch: true
    }
  ],
  glow: {
    mode: GlowMode.level,
    level: 0.6,
    isUser: false
  }
};

const SCENARIOS: Record<ScenarioName, PillView> = {
  idle: IDLE,
  captions: CAPTIONS,
  gearMenu: {
    ...IDLE,
    sharedDisplay: MONITORS[0]?.id ?? null,
    sharedDisplayName: MONITORS[0]?.name ?? null,
    update: {
      text: "Check for updates",
      isAvailable: false,
      isAutoUpdateOn: true
    }
  },
  displayMenu: {
    ...IDLE,
    displays: [
      ...MONITORS,
      {
        id: "\\\\.\\DISPLAY3",
        name: "Display 3 · 1920×1080",
        refreshRateHertz: 144,
        x: 4480,
        y: 0,
        width: 1920,
        height: 1080
      }
    ],
    sharedDisplay: MONITORS[0]?.id ?? null,
    sharedDisplayName: MONITORS[0]?.name ?? null
  },
  keyPrompt: {
    ...IDLE,
    status: "Setup: Gemini needs an API key",
    engine: EngineKind.apiKey,
    isKeyPromptShown: true,
    isFocusable: true
  },
  updateAvailable: {
    ...IDLE,
    update: {
      text: "Restart to update to 1.2.3",
      isAvailable: true,
      isAutoUpdateOn: false
    }
  },
  cameraShared: {
    ...IDLE,
    isCameraShared: true,
    sharedDisplay: MONITORS[1]?.id ?? null,
    sharedDisplayName: MONITORS[1]?.name ?? null
  }
};

export function isScenarioName(value: string | undefined): value is ScenarioName {
  return SCENARIO_ORDER.some(name => name === value);
}

export function scenarioView(name: ScenarioName) {
  return pillViewSchema.parse(SCENARIOS[name]);
}

export function nextScenario({ current, step }: {
  current: ScenarioName;
  step: number;
}) {
  const count = SCENARIO_ORDER.length;
  const index = SCENARIO_ORDER.indexOf(current);
  const next = SCENARIO_ORDER[(index + step + count) % count];
  return next ?? current;
}
