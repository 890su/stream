// The system back closes what is open on top — a menu, a panel, a dialog — instead of leaving the app. Each open
// window pushes a history entry; back pops it and closes the newest window. A window closed by its own button
// takes its entry back quietly. The drawer, details and an open conversation keep their own entries (drawer.js,
// details.js, chatview.js); this is for everything else. `createBackStack(win)` is tested with a fake window.

export function createBackStack(win) {
  const stack = []; // { close, live }
  const page = Math.random().toString(36).slice(2); // this load of the page: older entries are not ours
  const ours = () => (win.history.state?.page === page ? win.history.state.overlay : 0);
  let quiet = 0; // pops we caused ourselves, not the user's back

  win.addEventListener('popstate', () => {
    if (quiet) { quiet -= 1; return; }
    // Close every window above the entry we landed on (one for a plain back).
    const depth = ours();
    while (stack.length > depth) {
      const top = stack.pop();
      top.live = false;
      top.close();
    }
  });

  // Call when a window opens with how to close it; call the returned function when it closes by itself.
  function opened(close) {
    const entry = { close, live: true };
    stack.push(entry);
    win.history.pushState({ overlay: stack.length, page }, '');
    return () => {
      if (!entry.live) return;
      entry.live = false;
      stack.splice(stack.indexOf(entry), 1);
      if (ours()) { quiet += 1; win.history.back(); }
    };
  }

  return { opened };
}

// The browser's stack; dialogs opened with showModal() join it on their own.
export const backStack = typeof window === 'undefined' ? null : createBackStack(window);

export function watchDialogs(root = document) {
  for (const dialog of root.querySelectorAll('dialog')) {
    const show = dialog.showModal.bind(dialog);
    const hide = dialog.close.bind(dialog);
    let done = null;
    const release = () => { done?.(); done = null; };
    dialog.showModal = () => {
      show();
      release();
      done = backStack.opened(() => { done = null; hide(); });
    };
    // Closed by code (close()) or by a form with method="dialog" (the close event): the entry goes back either way.
    dialog.close = (value) => { hide(value); release(); };
    dialog.addEventListener('close', release);
  }
}
