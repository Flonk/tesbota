const MONTHS = [
  "Frostfall",
  "Deepfrost",
  "Frostbreak",
  "Seedwake",
  "Longlight",
  "Highsun",
  "Reaptide",
  "Emberwane",
];

export function shortDate(stamp) {
  const found = /^(\d+)\s+([A-Za-z]+)\s+(\d+E\d+)/.exec(String(stamp || "").trim());
  if (!found) return stamp || "—";
  const month = MONTHS.indexOf(found[2]) + 1;
  return month ? `${found[1]}.${month}. ${found[3]}` : stamp;
}

export function timeOf(stamp) {
  const found = /(\d{1,2}:\d{2})\s*$/.exec(String(stamp || ""));
  return found ? found[1] : "";
}
