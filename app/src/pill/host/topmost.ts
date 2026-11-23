interface TopmostPresenter {
  isAlwaysOnTop: boolean;
}

// A window created hidden reports `isAlwaysOnTop` while Windows never gave it the topmost style, so
// other apps' windows stay above the pill. Turning it off and on again makes Windows apply it
export function reassertTopmost(presenter: TopmostPresenter) {
  presenter.isAlwaysOnTop = false;
  presenter.isAlwaysOnTop = true;
}
