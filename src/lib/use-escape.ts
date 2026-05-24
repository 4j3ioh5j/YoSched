import { useEffect, useRef } from "react";

export function useEscape(handler: () => void) {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handlerRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
