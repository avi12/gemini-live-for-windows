import { defineConfig } from "wxt";

// WXT loads its config from the default export.
export default defineConfig({
  srcDir: "src",
  webExt: {
    disabled: true
  },
  manifest: {
    name: "Gemini Live for Windows - Google session",
    description:
      "Keeps the Gemini Live desktop app signed in with this browser's Google session, and fresh as Google rotates it.",
    // Pins the extension ID to bejbkccodipbnbjeagmihnhnfadnjgeh - the only origin the app's
    // SessionLink accepts (ExtensionOrigin in src/GeminiLive/Glic/SessionLink.cs). The matching
    // private key, keys/chrome.pem, signs the release .crx and never enters git.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoYHf3ztGQprPgVj6UIc1aLr+xPvyEqlhvdtvGrDWGbBMu6xqSN0pq0DBAKZstX5nPc/xu0dmYbugMlTE6wqq0LkbtzPkJl9tMaZvu2nKEPAryQKKutQIhNeA7BJfHzN6IgZgDXEM3uAKLzE5QAsAKBDaJ26gI6HsIjBimOG59dsNed8+Ef0/SIfnuOZp/PRtcCrnJ8Sbj7ONWlITX0ywn7WXMl/uizmFxp2CEC1RKyv+2p+PqgwdDxo8q866h5lGOzNC3o2lq0El3N/+XIcSX77Rn3bRhTZ6Uc5E5xf3iYjg0TPGiQAk/QZoFQ84KTTAT19XsgSmUjwiapUAGm8bVQIDAQAB",
    // nativeMessaging: the app's native host (com.avi12.gemini_live) hands out the link's port and
    // token, wherever the browser installed this extension from.
    permissions: ["cookies", "alarms", "nativeMessaging"],
    // Both schemes: Chrome derives a cookie's access URL from its Secure flag, so cookies.getAll
    // only returns Google's non-Secure session cookies (SID, HSID, APISID) with an http:// grant.
    // An https-only grant silently drops them and the jar signs the app in as signed-out.
    host_permissions: ["*://*.google.com/*"],
    icons: {
      16: "icon/16.png",
      48: "icon/48.png",
      128: "icon/128.png"
    }
  }
});
