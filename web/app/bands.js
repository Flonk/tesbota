"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { typing } from "./keyboard";

export function useSplit(app) {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const grab = useRef(null);
  const swallow = useRef(false);
  const splitNow = useRef(50);

  useEffect(() => {
    const saved = Number(localStorage.getItem("tesbota.split"));
    if (saved >= 15 && saved <= 85) {
      setSplit(saved);
      splitNow.current = saved;
    }
  }, []);

  function grabBar(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("textarea, input")) return;
    const box = app.current?.getBoundingClientRect();
    if (!box) return;
    swallow.current = false;
    grab.current = { box, id: e.pointerId, from: e.clientY, moved: false };
    window.addEventListener("pointermove", dragBar);
    window.addEventListener("pointerup", dropBar);
    window.addEventListener("pointercancel", dropBar);
  }

  function dragBar(e) {
    const g = grab.current;
    if (!g || e.pointerId !== g.id) return;
    if (!g.moved) {
      if (Math.abs(e.clientY - g.from) < 5) return;
      g.moved = true;
      setDragging(true);
    }
    const pct = ((e.clientY - g.box.top) / g.box.height) * 100;
    const next = Math.max(18, Math.min(82, pct));
    splitNow.current = next;
    setSplit(next);
  }

  function dropBar(e) {
    const g = grab.current;
    if (!g || e.pointerId !== g.id) return;
    grab.current = null;
    window.removeEventListener("pointermove", dragBar);
    window.removeEventListener("pointerup", dropBar);
    window.removeEventListener("pointercancel", dropBar);
    if (!g.moved) return;
    setDragging(false);
    swallow.current = true;
    localStorage.setItem("tesbota.split", String(Math.round(splitNow.current)));
  }

  function clickBar(e) {
    if (!swallow.current) return;
    swallow.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  function evenBar(e) {
    if (e.target.closest("button, textarea, input")) return;
    splitNow.current = 50;
    setSplit(50);
    localStorage.setItem("tesbota.split", "50");
  }

  return { split, dragging, handle: { onPointerDown: grabBar, onClickCapture: clickBar, onDoubleClick: evenBar } };
}

export function useDeck(count, held) {
  const deck = useRef(null);
  const pinned = useRef(true);
  const [at, setAt] = useState(0);

  const go = useCallback(
    (i) => {
      const el = deck.current;
      if (!el || !count) return;
      const next = Math.max(0, Math.min(count - 1, i));
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    },
    [count]
  );

  useEffect(() => {
    if (pinned.current && count) go(count - 1);
  }, [count, go]);

  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented || typing(e.target) || held) return;
      if (e.key === "ArrowLeft") go(at - 1);
      if (e.key === "ArrowRight") go(at + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go, held]);

  function onScroll() {
    const el = deck.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setAt(i);
    pinned.current = i >= count - 1;
  }

  return { deck, at, go, onScroll };
}
