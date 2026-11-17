// Keeps the browser tab title in sync with the current page.
// Title format: "<Page> · Gradia" (or just "Gradia" with no argument).
import { useEffect } from "react";

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Gradia` : "Gradia";
  }, [title]);
}
