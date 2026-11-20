import { PermissionDecision, PermissionKind } from "@/google/web-host/web-view-port.ts";

const ALLOWED_HOST_SUFFIXES = ["google.com", "youtube.com"];
const BLANK_PAGE = "about:blank";

// The parked window can never show a permission prompt, so every request is answered up front.
// These pages are held to Google's own sites (see isGoogleNavigation), so allowing is safe. The
// page never opens the camera itself (the shared view captures it in-process); denying it keeps
// Chromium from opening the device, which is what triggers Windows' camera prompt.
export function decideHiddenPagePermission(kind: PermissionKind) {
  const isCamera = kind === PermissionKind.CAMERA;
  if (isCamera) {
    return PermissionDecision.DENY;
  }

  return PermissionDecision.ALLOW;
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
