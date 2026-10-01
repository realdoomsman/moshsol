/** localStorage flag set by "Got it" on the first-visit explainer (`NewHere`). */
export const NEW_HERE_DISMISSED_KEY = "holdfast:new-here:dismissed";

/**
 * Inline head script (root layout): runs before first paint and marks `<html data-new-here="off">`
 * for visitors who dismissed the explainer or have a remembered wallet (wallet-adapter's
 * `walletName`, so autoConnect will sign them in). `NewHere` is server-rendered for everyone and
 * hidden by that attribute, so it never pops in (layout shift) nor flashes for returning visitors.
 */
export const NEW_HERE_BOOT_SCRIPT = `try{var s=localStorage;if(s.getItem(${JSON.stringify(NEW_HERE_DISMISSED_KEY)})==="1"||s.getItem("walletName"))document.documentElement.dataset.newHere="off"}catch(e){}`;
