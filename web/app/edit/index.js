import People from "./People";
import Places from "./Places";
import Items from "./Items";
import Books from "./Books";
import Aspects from "./Aspects";
import Abilities from "./Abilities";

export const EDITORS = {
  people: People,
  places: Places,
  items: Items,
  books: Books,
  aspects: Aspects,
  abilities: Abilities,
};

/** Merge an object section, replace a list section. */
export function merged(draft, section, value) {
  const was = draft[section];
  const object = value && typeof value === "object" && !Array.isArray(value);
  return { ...draft, [section]: object && was && typeof was === "object" ? { ...was, ...value } : value };
}
