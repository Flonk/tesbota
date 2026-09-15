"use client";

const GLYPHS = {
  chat: <path d="M3.5 4.5h17v11h-11l-6 4.5z" />,
  map: (
    <>
      <path d="M9 4.5 3.5 7v12.5L9 17l6 2.5 5.5-2.5V4.5L15 7z" />
      <path d="M9 4.5V17M15 7V19.5" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  people: (
    <>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.4M18 13.4a6 6 0 0 1 3.5 5.3" />
    </>
  ),
  shelf: (
    <>
      <path d="M4.5 5h4v13h-4zM10.5 5h4v13h-4z" />
      <path d="M16.5 6.4l3.4.9-2.6 10.9-3.4-.9z" />
      <path d="M3 20.5h18" />
    </>
  ),
  book: (
    <>
      <path d="M12 7s-2-2.5-8-2.5v13c6 0 8 2.5 8 2.5s2-2.5 8-2.5v-13C14 4.5 12 7 12 7z" />
      <path d="M12 7v12.5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.5-6.4 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.6 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </>
  ),
  box: (
    <>
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5 3.5 16.5z" />
      <path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" />
    </>
  ),
  pen: (
    <>
      <path d="M4.5 19.5l3.2-1 11-11a2.2 2.2 0 0 0-3.2-3.2l-11 11z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8.7" cy="8.7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.3" cy="15.3" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  silence: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.6a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.1-2.5 3.8" />
      <circle cx="12" cy="17.4" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  pulse: <path d="M3 12.5h4l2.5-6.5 4 13 2.5-6.5h5" />,
  flag: (
    <>
      <path d="M6 20.5V4.5c4-2 8 2 12 0v9c-4 2-8-2-12 0" />
    </>
  ),
  lines: <path d="M5 6.5h14M5 11.5h14M5 16.5h9" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.2v5.4" />
      <circle cx="12" cy="7.9" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.8" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  scales: (
    <>
      <path d="M12 4.5v15M6 19.5h12M4 9h16M8.5 8 5.5 14h6zM15.5 8l-3 6h6z" />
    </>
  ),
  db: (
    <>
      <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
      <path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </>
  ),
  sword: (
    <>
      <path d="M20 4.5 9.5 15M20 4.5h-3.6M20 4.5v3.6" />
      <path d="M5.5 15.5 8 13l3 3-2.5 2.5z" />
      <path d="M4 20l3-1.5M8.5 18.5 10 21" />
    </>
  ),
  shirt: (
    <>
      <path d="M8.5 3.5 12 6l3.5-2.5L20 6l-2 3.5-1.6-.9V20H7.6V8.6L6 9.5 4 6z" />
    </>
  ),
  helm: (
    <>
      <path d="M5 20v-8a7 7 0 0 1 14 0v8h-3.6v-4.6h-6.8V20z" />
      <path d="M12 12.4v3" />
    </>
  ),
  trousers: (
    <>
      <path d="M7 3.8h10l1 16.4h-4.6L12 11.4l-1.4 8.8H6z" />
      <path d="M7 7.2h10" />
    </>
  ),
  boot: (
    <>
      <path d="M8.8 3.8h4.3v8.4c0 1.4 1 2.2 2.4 2.7l2.4.9c1.3.5 2 1.3 2 2.5v1.9H8.8z" />
      <path d="M8.8 17.4h11.1" />
    </>
  ),
  ring: (
    <>
      <circle cx="12" cy="15.2" r="4.8" />
      <path d="M12 3.6 14.7 7 12 10.4 9.3 7z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 5.8v6.1c0 4 2.8 6.8 7 8.6 4.2-1.8 7-4.6 7-8.6V5.8z" />
    </>
  ),
  world: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5z" />
    </>
  ),
  orbit: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <ellipse cx="12" cy="12" rx="10" ry="4.6" transform="rotate(-28 12 12)" />
      <circle cx="4.4" cy="8.6" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  realm: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  flask: (
    <>
      <path d="M10 3.5h4M10.8 3.5v5.2L5.6 17a2.6 2.6 0 0 0 2.2 4h8.4a2.6 2.6 0 0 0 2.2-4l-5.2-8.3V3.5" />
      <path d="M7.6 14.5h8.8" />
    </>
  ),
  hammer: (
    <>
      <path d="M13.5 3.5 9 8l2.5 2.5L16 6z" />
      <path d="M9.2 6.2 6 4.6 3.6 7l1.6 3.2" />
      <path d="M11.5 10.5 4.5 17.5a2 2 0 1 0 2.8 2.8l7-7" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  sack: (
    <>
      <path d="M10 3.5h4l-1.2 3.2c3.2 1 5.7 4 5.7 7.6a6.5 6.5 0 0 1-13 0c0-3.6 2.5-6.6 5.7-7.6z" />
    </>
  ),
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M19.2 14.6a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.1 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1.03z" />
    </>
  ),
};

export default function Icon({ name, size = 13 }) {
  const glyph = GLYPHS[name];
  if (!glyph) return null;
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}
