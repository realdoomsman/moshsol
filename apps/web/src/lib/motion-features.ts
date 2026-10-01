/**
 * Motion's animation, gesture/drag and layout features, split out of the shared bundle: `Providers`
 * loads this chunk after hydration through `LazyMotion`, and components render `m.*` (motion/react-m).
 * `domMax` because the dialog sheet drags and the tab/segment indicators use `layoutId`.
 */
export { domMax as default } from "motion/react";
