import { EngineKind, GlowMode } from "@gemini-live/protocol/view";
import type { PillView } from "@gemini-live/protocol/view";

// The views the mock host serves, one per scenario: what the pill would get from the app.

export const ScenarioName = {
  IDLE: "idle",
  LISTENING: "listening",
  CAPTIONS: "captions",
  LONG_CAPTIONS: "longCaptions",
  GEAR_MENU: "gearMenu",
  DISPLAY_MENU: "displayMenu",
  KEY_PROMPT: "keyPrompt",
  UPDATE_AVAILABLE: "updateAvailable",
  CAMERA_SHARED: "cameraShared"
} as const;

export type ScenarioName = (typeof ScenarioName)[keyof typeof ScenarioName];

const MONITORS = [
  {
    id: "\\\\.\\DISPLAY1",
    index: 1,
    isPrimary: true,
    refreshRateHertz: 60,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080
  },
  {
    id: "\\\\.\\DISPLAY2",
    index: 2,
    isPrimary: false,
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

const FIRST_DISPLAY_ID = MONITORS[0]?.id ?? null;
const SECOND_DISPLAY_ID = MONITORS[1]?.id ?? null;

const IDLE: PillView = {
  status: "Listening",
  statusDetail: "",
  isMuted: false,
  lines: [],
  links: [],
  displays: MONITORS,
  pillDisplay: FIRST_DISPLAY_ID,
  sharedDisplay: null,
  isExtensionNeeded: false,
  isExtensionStepsShown: false,
  isKeyPromptShown: false,
  engine: EngineKind.GOOGLE,
  microphones: MICROPHONES,
  microphoneId: "mic-headset",
  isCameraShared: false,
  update: null,
  glow: {
    mode: GlowMode.BREATHE,
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
      isSearch: false,
      faviconUri: "https://www.google.com/s2/favicons?domain=en.wikipedia.org&sz=32"
    },
    {
      id: "link-2",
      title: "tallest buildings",
      uri: "https://www.google.com/search?q=tallest+buildings",
      address: "google.com",
      isSearch: true,
      faviconUri: "https://www.google.com/s2/favicons?domain=www.google.com&sz=32"
    }
  ],
  glow: {
    mode: GlowMode.LEVEL,
    level: 0.6,
    isUser: false
  }
};

const LONG_CAPTIONS: PillView = {
  ...IDLE,
  lines: [
    {
      id: "line-1",
      text: "מה מזג האוויר מחר?",
      isUser: true,
      isNote: false
    },
    {
      id: "line-2",
      text: "שלום! במה אוכל לעזור לך היום?",
      isUser: false,
      isNote: false
    },
    {
      id: "line-3",
      text: "There is no rain expected in Tel Aviv-Yafo over the next week. The forecast calls for clear, sunny weather through at least next Monday.",
      isUser: true,
      isNote: false
    },
    {
      id: "line-4",
      text: "Thank you for that update on the weather. It's always good to know what the forecast is like when planning the week ahead. Is there anything else I can help you with today?",
      isUser: false,
      isNote: false
    }
  ],
  links: CAPTIONS.links.slice(0, 1)
};

export const SCENARIO_VIEWS: Record<ScenarioName, PillView> = {
  [ScenarioName.IDLE]: IDLE,
  [ScenarioName.LISTENING]: {
    ...IDLE,
    glow: {
      mode: GlowMode.LEVEL,
      level: 0,
      isUser: true
    }
  },
  [ScenarioName.CAPTIONS]: CAPTIONS,
  [ScenarioName.LONG_CAPTIONS]: LONG_CAPTIONS,
  [ScenarioName.GEAR_MENU]: {
    ...IDLE,
    sharedDisplay: FIRST_DISPLAY_ID,
    update: {
      readyVersion: null,
      isAutoUpdateOn: true
    }
  },
  [ScenarioName.DISPLAY_MENU]: {
    ...IDLE,
    displays: [
      ...MONITORS,
      {
        id: "\\\\.\\DISPLAY3",
        index: 3,
        isPrimary: false,
        refreshRateHertz: 144,
        x: 4480,
        y: 0,
        width: 1920,
        height: 1080
      }
    ],
    sharedDisplay: FIRST_DISPLAY_ID
  },
  [ScenarioName.KEY_PROMPT]: {
    ...IDLE,
    status: "Setup: Gemini needs an API key",
    engine: EngineKind.API_KEY,
    isKeyPromptShown: true,
    isFocusable: true
  },
  [ScenarioName.UPDATE_AVAILABLE]: {
    ...IDLE,
    update: {
      readyVersion: "1.2.3",
      isAutoUpdateOn: false
    }
  },
  [ScenarioName.CAMERA_SHARED]: {
    ...IDLE,
    isCameraShared: true,
    sharedDisplay: SECOND_DISPLAY_ID
  }
};
