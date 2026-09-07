"use client";

import { useEffect, useState } from "react";

const TYPING = /^(INPUT|TEXTAREA)$/;

export function useKeyboardAvoid(threshold = 120, query = "(max-width: 640px)") {
  const [inset, setInset] = useState(0);
  const [side, setSide] = useState(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const read = () => setNarrow(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, [query]);

  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const hidden = window.innerHeight - view.height - view.offsetTop;
        setInset(hidden > threshold ? Math.round(hidden) : 0);
      });
    };
    measure();
    view.addEventListener("resize", measure);
    view.addEventListener("scroll", measure);
    return () => {
      cancelAnimationFrame(frame);
      view.removeEventListener("resize", measure);
      view.removeEventListener("scroll", measure);
    };
  }, [threshold]);

  useEffect(() => {
    let letting = 0;
    const focused = (e) => {
      const el = e.target;
      if (!TYPING.test(el.tagName || "") && !el.isContentEditable) return;
      clearTimeout(letting);
      setSide(el.closest(".turns") ? "turns" : el.closest(".tabsband") ? "tabs" : null);
    };
    const blurred = () => {
      clearTimeout(letting);
      letting = setTimeout(() => setSide(null), 250);
    };
    document.addEventListener("focusin", focused);
    document.addEventListener("focusout", blurred);
    return () => {
      clearTimeout(letting);
      document.removeEventListener("focusin", focused);
      document.removeEventListener("focusout", blurred);
    };
  }, []);

  const avoiding = narrow && inset > 0;
  return {
    inset: avoiding ? inset : 0,
    collapse: avoiding ? (side === "turns" ? "tabs" : "turns") : null,
  };
}
