"use client";

import { useCallback, useEffect, useRef, useState } from "react";

async function answer(res) {
  const payload = await res.json().catch(() => null);
  const error =
    payload?.error ||
    (!res.ok ? `${res.status} ${res.statusText}`.trim() : payload === null ? "the answer was not json" : null);
  return { ok: !error, status: res.status, payload, error };
}

export async function send(path, body, method = "POST") {
  try {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return await answer(res);
  } catch (err) {
    return { ok: false, status: null, payload: null, error: String(err) };
  }
}

export function useJSON(url) {
  const [got, setGot] = useState({ data: null, error: null });
  const asked = useRef(null);

  const reload = useCallback(() => {
    const mine = {};
    asked.current = mine;
    return fetch(url, { cache: "no-store" })
      .then(answer)
      .catch((err) => ({ ok: false, payload: null, error: String(err) }))
      .then(({ ok, payload, error }) => {
        if (asked.current === mine) setGot(ok ? { data: payload, error: null } : { data: null, error });
      });
  }, [url]);

  useEffect(() => {
    reload();
    return () => {
      asked.current = null;
    };
  }, [reload]);

  return { ...got, reload };
}
