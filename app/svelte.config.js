import { winuiDiagnostics } from "winui-svelte/preprocess";

const winui = winuiDiagnostics();

export default {
  preprocess: [winui.preprocess],
  compilerOptions: {
    warningFilter: winui.warningFilter
  }
};
