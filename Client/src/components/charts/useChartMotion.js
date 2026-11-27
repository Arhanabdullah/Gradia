import { useReducedMotion } from "framer-motion";

// Recharts animates by default; keep its transitions smooth but honour
// prefers-reduced-motion (Recharts has no built-in media-query handling).
export const CHART_ANIMATION_DURATION = 600;
export const CHART_ANIMATION_EASING = "ease-out";

export function useChartMotion() {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) return { isAnimationActive: false };
  return {
    isAnimationActive: true,
    animationDuration: CHART_ANIMATION_DURATION,
    animationEasing: CHART_ANIMATION_EASING,
  };
}
