// How Windows started this packaged process (`ExtendedActivationKind` of the Windows App SDK), for
// `describeActivation`. Needs the Windows App SDK initialised on this thread; undefined when the
// answer cannot be had, as in an unpackaged run.
export async function readPackagedKind() {
  try {
    const lifecycle = await import("winui-svelte/bindings/microsoft/windows/app-lifecycle/AppInstance");
    return lifecycle.AppInstance.getCurrent().getActivatedEventArgs().kind;
  } catch {
    return undefined;
  }
}
