// Motion-side mirrors of the CSS easing tokens in styles/tokens.css
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/**
 * Card focus moving along a row (T1): on-screen movement, frequent, so short. A
 * critically damped spring rather than a tween: holding ← → retargets mid-flight
 * and keeps its velocity instead of restarting the curve, so fast browsing glides.
 */
export const FOCUS_MOVE = { type: "spring" as const, visualDuration: 0.24, bounce: 0 };

/** Opening a film (T4/T5): a spring, so Esc mid-flight reverses from where it is. */
export const EXPAND = { type: "spring" as const, duration: 0.5, bounce: 0.12 };

/** Press feedback for anything driven by Motion (CSS :active loses to inline transforms). */
export const PRESS = { scale: 0.97, transition: { duration: 0.14, ease: EASE_OUT } };
