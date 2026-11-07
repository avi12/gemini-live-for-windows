import { PermissionDecision, PermissionKind } from "@/google/web-host/web-view-port.ts";

const ALLOWED_HOST_SUFFIXES = ["google.com", "youtube.com"];
const BLANK_PAGE = "about:blank";

// The parked window can never show a permission prompt, so the microphone is granted up front. The
// page never opens the camera itself (the shared view captures it in-process); denying it keeps
// Chromium from opening the device, which is what triggers Windows' camera prompt.
export function decideGlicPermission(kind: PermissionKind) {
  const isMicrophone = kind === PermissionKind.microphone;
  if (isMicrophone) {
    return PermissionDecision.allow;
  }

  const isCamera = kind === PermissionKind.camera;
  if (isCamera) {
    return PermissionDecision.deny;
  }

  return PermissionDecision.default;
}

function isGoogleHost(hostname: string) {
  return ALLOWED_HOST_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

// A hidden page that only ever shows Google's own sign-in and apps has no business elsewhere:
// anything else is a redirect to refuse
export function isGoogleNavigation(uri: string) {
  const isBlank = uri === BLANK_PAGE;
  if (isBlank) {
    return true;
  }

  const parsed = URL.parse(uri);
  const isHttps = parsed?.protocol === "https:";
  const isForeign = !parsed || !isHttps;
  if (isForeign) {
    return false;
  }

  return isGoogleHost(parsed.hostname);
}
