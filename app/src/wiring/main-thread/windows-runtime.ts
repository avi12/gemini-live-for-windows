import { restartAfterCrash } from "winui-svelte/app";
import { initWindowsAppSdk } from "winui-svelte/bootstrap";

import { log } from "@/core/log/log.ts";
import { RECOVERED_ARGUMENT } from "@/entry/activation/activation.ts";
import { isError } from "@/lib/error-guards.ts";
import { errorMessage } from "@/lib/error-message.ts";

const WINDOWS_APP_SDK_MAJOR = 2;
const WINDOWS_APP_SDK_MINOR = 2;
const NOT_SUPPORTED_HRESULT = "0x80070032";

// Inside a package the runtime comes from the package's dependency, and the bootstrap refuses
export function startWindowsAppSdk({ isPackaged }: { isPackaged: boolean }) {
  try {
    initWindowsAppSdk({
      major: WINDOWS_APP_SDK_MAJOR,
      minor: WINDOWS_APP_SDK_MINOR,
      // Every WebView2 here names its own profile folder; the variable would send them all to one
      // folder, where the second browser with other options never starts
      webViewUserDataFolder: false
    });
  } catch (error) {
    const isRefusedByIdentity = isError(error) && error.message.includes(NOT_SUPPORTED_HRESULT);
    const isRuntimeFromPackage = isPackaged && isRefusedByIdentity;
    if (!isRuntimeFromPackage) {
      throw error;
    }
  }
}

// After a crash, a hang or an update, Windows offers to start the app again, as a recovered copy
// that comes up without a conversation. Failing to register only costs that offer.
export function registerCrashRestart() {
  try {
    restartAfterCrash({ arguments: [RECOVERED_ARGUMENT] });
  } catch (error) {
    log.write(`restart after a crash: ${errorMessage(error)}`);
  }
}
