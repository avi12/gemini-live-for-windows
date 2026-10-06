import { defineConfig } from 'wxt';

// WXT loads its config from the default export.
export default defineConfig({
  srcDir: 'src',
  webExt: {
    disabled: true,
  },
  manifest: {
    name: 'Gemini Live for Windows - Google session',
    description:
      "Keeps the Gemini Live desktop app signed in with this browser's Google session, and fresh as Google rotates it.",
    // Pins the extension ID to logpjalpegggobmjjimpacngnnhaakmd - the only origin the app's
    // SessionLink accepts (ExtensionOrigin in src/GeminiLive/Glic/SessionLink.cs).
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjkbRygmjyKhAuZfKfsxrkqlCaBmoOCM8WlYKq+31TxUtv+A+xe9Elz05nziYPjmam3jEYoK+07Ge3jYvvnV7tKc6lL+zJzwfog3HAklm2kOefD0gZTJ7kGEwiYlyjF+xzcwc37hbHObCtpcC+MVv7kZy74Q2bKY9NqwjkBHIBNtsrVXAQl7LbFnjNNsUiKNaPdSUyQ5RzO0KT8RUakjAJG0raAk995Ezopp1Ep1H+g9/6HWGYhY+vzAdp3ZIi6M7NM+/+6wkAHSOh4aF5jjSr+NKai3N7k04x4KMh7nUrLq8VoI9MuNfAXzaoTyUJ3MjCn2OoCppvrccr2eAWf/5LQIDAQAB',
    permissions: ['cookies', 'alarms'],
    // Both schemes: Chrome derives a cookie's access URL from its Secure flag, so cookies.getAll
    // only returns Google's non-Secure session cookies (SID, HSID, APISID) with an http:// grant.
    // An https-only grant silently drops them and the jar signs the app in as signed-out.
    host_permissions: ['*://*.google.com/*'],
    icons: {
      16: 'icon/16.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
