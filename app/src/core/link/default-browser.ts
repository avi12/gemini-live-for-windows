import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HTTPS_CHOICE_KEY = String.raw`HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice`;

const BrowserKind = {
  CHROME: "chrome",
  BRAVE: "brave",
  EDGE: "msedge"
} as const;
type BrowserKind = (typeof BrowserKind)[keyof typeof BrowserKind];

export interface DefaultBrowser {
  executable: BrowserKind;
  extensionsPage: string;
}

export type ReadProgId = () => Promise<string>;

async function readProgIdWithRegExe() {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", HTTPS_CHOICE_KEY, "/v", "ProgId"], {
      windowsHide: true
    });
    return /ProgId\s+REG_SZ\s+(\S+)/.exec(stdout)?.[1] ?? "";
  } catch {
    return "";
  }
}

function startsWith({ text, prefix }: { text: string; prefix: string }) {
  return text.toLowerCase().startsWith(prefix);
}

// The browser the user actually browses in, since that's whose Google session we want
export async function defaultBrowser(readProgId: ReadProgId = readProgIdWithRegExe) {
  const progId = await readProgId();
  if (
    startsWith({
      text: progId,
      prefix: "chrome"
    })
  ) {
    return {
      executable: BrowserKind.CHROME,
      extensionsPage: "chrome://extensions"
    };
  }

  if (
    startsWith({
      text: progId,
      prefix: "brave"
    })
  ) {
    return {
      executable: BrowserKind.BRAVE,
      extensionsPage: "brave://extensions"
    };
  }

  return {
    executable: BrowserKind.EDGE,
    extensionsPage: "edge://extensions"
  };
}
