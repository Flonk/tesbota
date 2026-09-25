"use client";

import { useEffect, useState } from "react";
import { useMedia } from "./ui";

export const typing = (el) => !!el?.closest?.("input, textarea, select, [contenteditable]");

export function useSaveKey(active, save) {
  useEffect(() => {
    if (!active) return;
    const key = (e) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      save();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [active, save]);
}

export function useKeyboardAvoid(threshold = 120, query = "(max-width: 640px)") {
  const [inset, setInset] = useState(0);
  const [settled, setSettled] = useState(0);
  const [view, setView] = useState({ top: 0, height: 0 });
  const [side, setSide] = useState(null);
  const narrow = useMedia(query);

  useEffect(() => {
    const port = window.visualViewport;
    if (!port) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const hidden = window.innerHeight - port.height;
        setInset(hidden > threshold ? Math.round(hidden) : 0);
        setView({ top: Math.round(port.offsetTop), height: Math.round(port.height) });
      });
    };
    measure();
    port.addEventListener("resize", measure);
    port.addEventListener("scroll", measure);
    return () => {
      cancelAnimationFrame(frame);
      port.removeEventListener("resize", measure);
      port.removeEventListener("scroll", measure);
    };
  }, [threshold]);

  useEffect(() => {
    const wait = setTimeout(() => setSettled(inset), inset > 0 ? 120 : 0);
    return () => clearTimeout(wait);
  }, [inset]);

  useEffect(() => {
    let letting = 0;
    const focused = (e) => {
      const el = e.target;
      if (!typing(el)) return;
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
    top: avoiding ? view.top : 0,
    height: avoiding ? view.height : 0,
    collapse:
      avoiding && settled > 0 ? (side === "turns" ? "tabs" : "turns") : null,
  };
}
