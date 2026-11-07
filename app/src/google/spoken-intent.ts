// Reads what a spoken line asks for, so the engine can route the requests Live can't serve:
// switching the PC lights, the Google apps only Gemini's text path reaches, and web searches
// whose links Live can only say. Refusals and web requests are read in English and Hebrew; Hebrew
// words carry prefixes, so those match without word bounds.

const APP_NAMES = [
  {
    pattern: /\b(gmail|e-?mail|inbox|mail)\b/i,
    name: "Gmail"
  },
  {
    pattern: /\b(keep|note|notes)\b/i,
    name: "Keep"
  },
  {
    pattern: /\b(task|tasks|to-?dos?)\b/i,
    name: "Tasks"
  },
  {
    pattern: /\b(calendar|schedule|meeting|event|events)\b/i,
    name: "Calendar"
  }
] as const;

const DEFAULT_APP_NAME = "your Google apps";

const REFUSAL = new RegExp(
  String.raw`\b(can'?t|cannot|don'?t|do not|unable|not able|no access)\b`
  + String.raw`|(איני|אינני|אני לא|לא)\s+(יכול|יכולה|יכולים|מסוגל|מסוגלת)|אין לי (גישה|אפשרות)`,
  "i"
);

const WEB_TOPIC = new RegExp(
  String.raw`\b(links?|urls?|websites?|web ?pages?|browse|browsing|search(ing)?|internet|online|real-time)\b`
  + "|קישור|לינק|כתובת|אתר|לגלוש|גלישה|לחפש|חיפוש|אינטרנט",
  "i"
);

// Plainly asking for a search or a link; a passing mention ("I linked it") isn't a request. Hebrew
// asks with the verb as often as the noun.
const WEB_REQUEST = new RegExp(
  String.raw`\b(search (for|the web|online|google)|google (it|for|that)|look (it |that )?up`
  + String.raw`|find (me )?(a |the )?(link|article|page|source)|(send|give|show) me (a |the )?links?`
  + String.raw`|link me|link (it|that)|links? (to|for)|the link|urls? (for|of)|sources? (for|on))\b`
  + "|קישור|לינק|תקשר|תקשרי|לקשר|קשר אותי|קשרי אותי|תחפש|תחפשי|חפש לי|חפשי לי|לחפש"
  + "|תמצא לי|תמצאי לי",
  "i"
);

// Gemini sending the user off to find a page themselves instead of giving it.
const POINTS_TO_SITE = new RegExp(
  String.raw`\b(you (can|could|'ll|will) (find|read|see) (it|them|this) (on|at)`
  + String.raw`|on (their|the|its) (official )?(site|website|blog)|visit (their|the) (official )?(site|website))\b`
  + "|באתר הרשמי|באתר שלהם|בכתובת|תוכל למצוא|תוכלי למצוא|יכול למצוא|יכולה למצוא",
  "i"
);

// Only apps Gemini's web text turns can reach. Not Home, alarms or timers: the web has no tool
// for them, so the detour would only pause Live for a dead end.
const APP_TOPIC = /\b(calendar|schedule|meeting|event|remind|reminder|task|to-?do|note|keep|gmail|e-?mail|inbox|mail)\b/i;

const INTENT = new RegExp(
  String.raw`\b(add|create|schedule|set|make|new|delete|remove|cancel|move|reschedule|turn on|turn off`
  + String.raw`|switch on|switch off|dim|list|show|check|read|send|mark|star|archive|do i have`
  + String.raw`|what'?s on|what is on|what'?s my|what are my|when'?s|when is)\b`,
  "i"
);

const LIGHTS_TOPIC = /\blights?\b/i;
const SWITCH_VERB = /\b(turn|switch|put|flip|kill)\b/i;
const TURN_ON = /\bon\b/i;
const TURN_OFF = /\b(off|out)\b/i;
const QUESTION = /^\s*(are|is|was|were|do|does|did|can|could|would|will|should|what|which|when|how|why|whose)\b/i;

export const IntentKind = {
  lights: "lights",
  app: "app",
  web: "web"
} as const;

export type SpokenIntent = NonNullable<ReturnType<typeof classifyUtterance>>;

// A plain spoken command to switch the lights: it names the lights, with a switch verb and a clear
// direction. Questions and Calendar/Keep/Tasks requests that merely mention lights fall through to
// their own paths, so the light is never toggled by accident.
export function lightsCommand(text: string) {
  const isCommand = !QUESTION.test(text) && !APP_TOPIC.test(text) && LIGHTS_TOPIC.test(text)
    && SWITCH_VERB.test(text);
  if (!isCommand) {
    return undefined;
  }

  const isTurningOn = TURN_ON.test(text);
  const isTurningOff = TURN_OFF.test(text);
  const isAmbiguous = isTurningOn === isTurningOff;
  if (isAmbiguous) {
    return undefined;
  }

  return { isOn: isTurningOn };
}

// Gemini refusing an app it can't reach in Live: a refusal plus an app topic
export function needsApp(text: string) {
  return REFUSAL.test(text) && APP_TOPIC.test(text);
}

// The user plainly asking an app to do or report something, which Live can't
export function targetsApp(text: string) {
  return APP_TOPIC.test(text) && INTENT.test(text);
}

// The user asking for a web search or a link outright, which Live answers by voice only
export function asksWeb(text: string) {
  return WEB_REQUEST.test(text);
}

// Gemini not handing over a page: saying it can't search, browse or give a link, or sending the
// user off to find it on a site themselves
export function withholdsLink(text: string) {
  const isRefusingWeb = REFUSAL.test(text) && WEB_TOPIC.test(text);
  return isRefusingWeb || POINTS_TO_SITE.test(text);
}

export function appName(request: string) {
  return APP_NAMES.find(({ pattern }) => pattern.test(request))?.name ?? DEFAULT_APP_NAME;
}

// What a settled user utterance asks for, in the order the paths are tried; undefined when Live
// can answer it itself
export function classifyUtterance(text: string) {
  const lights = lightsCommand(text);
  if (lights) {
    return {
      kind: IntentKind.lights,
      isOn: lights.isOn
    };
  }

  if (targetsApp(text)) {
    return { kind: IntentKind.app };
  }

  if (asksWeb(text)) {
    return { kind: IntentKind.web };
  }

  return undefined;
}

// What Gemini's own line says it cannot do that the text path can
export function classifyRefusal(line: string) {
  if (needsApp(line)) {
    return IntentKind.app;
  }

  if (withholdsLink(line)) {
    return IntentKind.web;
  }

  return undefined;
}
