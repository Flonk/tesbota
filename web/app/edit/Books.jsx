"use client";

import { Act, Row } from "../ui";
import { Field, Group, Pick, reader } from "./fields";
import { Tags } from "./Common";

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "unique"];

export default function BooksEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "book", thing.book);
  const texts = draft.passages ?? (thing.passages || []).map((p) => p.text);
  const set = (next) => change("passages", next);
  const move = (n, by) => {
    const next = [...texts];
    [next[n], next[n + by]] = [next[n + by], next[n]];
    set(next);
  };
  return (
    <>
      <div className="efields">
        <Field label="author" value={get("author")} onChange={put("author")} />
        <Pick label="author entry" kind="people" value={get("author_id")} onChange={put("author_id")} />
        <Field label="written" value={get("written")} onChange={put("written")} />
        <Field label="rarity" kind="choice" options={RARITIES} value={get("rarity")} onChange={put("rarity")} />
      </div>
      <Group label="text">
        <div className="emany">
          {texts.map((text, n) => (
            <div key={n}>
              <Field
                kind="text"
                label={String(n + 1)}
                value={text}
                onChange={(v) => set(texts.map((t, m) => (m === n ? v : t)))}
              />
              <Row pad={false} ruled={false}>
                <Act onClick={() => move(n, -1)} disabled={n === 0}>
                  up
                </Act>
                <Act onClick={() => move(n, 1)} disabled={n === texts.length - 1}>
                  down
                </Act>
                <Act onClick={() => set(texts.filter((_, m) => m !== n))}>remove</Act>
              </Row>
            </div>
          ))}
        </div>
        <Act onClick={() => set([...texts, ""])}>add passage</Act>
      </Group>
      <Tags thing={thing} draft={draft} change={change} />
    </>
  );
}
