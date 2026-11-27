// Smooth native <dialog> dismissal.
//
// Native dialogs hide instantly when close() is called. To play the CSS exit
// transition defined for dialog.dialog-panel in index.css, we flag the element
// with [data-closing], let the transition run, then close() once it settles.
// Reduced-motion users close immediately; a safety timeout always resolves.

const DIALOG_EXIT_MS = 260;

function prefersReducedMotion() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export async function closeDialog(dialog) {
  if (!dialog || typeof dialog.close !== "function") return;
  if (!dialog.open) {
    dialog.close();
    return;
  }

  if (prefersReducedMotion()) {
    dialog.close();
    return;
  }

  dialog.setAttribute("data-closing", "");

  // Allow the browser to flush styles and start the transition before waiting.
  await new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });

  if (typeof dialog.getAnimations === "function") {
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((animation) => animation.finished)),
        new Promise((resolve) => setTimeout(resolve, DIALOG_EXIT_MS + 100)),
      ]);
    } else {
      await new Promise((resolve) => setTimeout(resolve, DIALOG_EXIT_MS));
    }
  } else {
    await new Promise((resolve) => setTimeout(resolve, DIALOG_EXIT_MS));
  }

  // Bail if something re-opened or already closed the dialog mid-animation.
  if (!dialog.hasAttribute("data-closing") || !dialog.open) return;
  dialog.removeAttribute("data-closing");
  dialog.close();
}
