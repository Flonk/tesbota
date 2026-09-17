import hashlib
from pathlib import Path

from . import chronicle
from .canon import does
from .config import EXPLORER, FLEE_FLOOR
from .state import explorer_name

PROMPTS = Path(__file__).parent / "prompts"
INCLUDE = ("COMMON", "WRITING")


def block(name):
    """A prompt is a file. `$COMMON` on a line of its own pulls in the block every
    agent above the explorer shares, so what is read here is what the agent is sent."""
    text = (PROMPTS / f"{name}.md").read_text()
    for part in INCLUDE:
        if f"${part}" in text:
            text = text.replace(f"${part}", (PROMPTS / f"{part.lower()}.md").read_text().rstrip("\n"))
    return text


def __getattr__(name):
    slug = {
        "EXPLORER_SYSTEM": "explorer", "GM_SYSTEM": "gm", "GM_PROPOSE_SYSTEM": "propose",
        "LORE1_SYSTEM": "lore1", "LORE2_SYSTEM": "lore2", "LORE3_SYSTEM": "lore3",
        "LORE4_SYSTEM": "lore4", "LORE1_QUERY_SYSTEM": "queries",
        "QUESTMASTER_SYSTEM": "questmaster", "READING": "common", "LORE_WRITING": "writing",
    }.get(name)
    if slug is None:
        raise AttributeError(name)
    return block(slug)


def fill(text):
    """The explorer has a name and their book is named after them; both change when
    a new one sets out."""
    return (
        (text or "")
        .replace("$CHRONICLE_ID", chronicle.book_id())
        .replace("$CHRONICLE_NAME", chronicle.book_title())
        .replace("$EXPLORER", explorer_name())
        .replace("$HOLDER", EXPLORER)
    )




def tally(qty):
    """One of a thing says nothing; a debt has to say itself."""
    qty = int(qty or 1)
    if qty < 0:
        return f" (owes {abs(qty)})"
    return f" x{qty}" if qty > 1 else ""


def told(parts, sent, key, head, body, still):
    """The game master keeps one session for the whole campaign, so a block it has
    already been handed is not worth the tokens of handing over again. What moved is
    spelled out; what did not gets a line saying so."""
    mark = hashlib.sha1(body.encode("utf-8")).hexdigest()[:16]
    if sent is None or sent.get(key) != mark:
        if sent is not None:
            sent[key] = mark
        parts.append(f"{head}\n{body}")
    else:
        parts.append(still)


def render_quests(quests):
    lines = []
    for q in quests or []:
        if q.get("status") != "active":
            continue
        giver = f", set by {q['giver']}" if q.get("giver") else ""
        lines.append(f"  [{q['id']}] {q.get('title')}{giver}")
        if q.get("detail"):
            lines.append(f"      {q['detail']}")
        if q.get("script"):
            lines.append("      script, yours alone:")
            for beat in str(q["script"]).splitlines():
                if beat.strip():
                    lines.append(f"        {beat.strip()}")
    return "\n".join(lines) or "  (nothing)"


def render_inventory(items, load=None):
    lines = []
    for item in items or []:
        if isinstance(item, dict):
            where = " (worn)" if item.get("worn") else ""
            lines.append(f"  - {item.get('name')}{tally(item.get('qty'))}{where}")
        else:
            lines.append(f"  - {item}")
    out = "\n".join(lines) or "  (nothing)"
    if load:
        said = f"  they are carrying {load['carried']:g} of {load['capacity']:g} stone"
        if load.get("over"):
            said += (
                f", which is past what they can manage — every stretch of road takes "
                f"{load.get('drag', 1):g} times as long, and they feel every step of it"
            )
        out += "\n" + said
    return out


def render_holdings(holders):
    lines = []
    for holder in holders or []:
        lines.append(f"  {holder['name']} ({holder['id']}):")
        for item in holder.get("items") or []:
            lines.append(f"    - {item.get('name')}{tally(item.get('qty'))}")
    return "\n".join(lines) or "  (nothing)"


def explorer_turn(narration, nudge=None, check=None):
    text = narration or "You become aware. That is all, for now."
    if check:
        dice = " ".join(str(n) for n in check.get("rolls") or [check.get("roll")])
        line = (
            f"\n\nYou tried it: {check['skill']}, d20 {dice} {check['bonus']:+d} "
            f"against {check['dc']} — you {'made it' if check['passed'] else 'fell short'}."
        )
        if check.get("against"):
            line += (
                f" You are {' and '.join(check['against'])}, so you threw "
                f"{len(check['rolls'])} dice and kept the worst."
            )
        text += line
    if nudge:
        text += (
            "\n\nYou have not said what you are doing this turn. Looking and speaking "
            "come after that, never before it. Say what you do."
        )
    return text


CARRY_SAME = "What they are carrying is exactly as you were last told."
KEEP_SAME = "What everything here keeps is exactly as you were last told."
QUEST_SAME = "What they have taken on is exactly as you were last told."

VERBS = """  ATTACK          swing with the {weapon}, {weapon_damage} damage
  ITEM <name>     use one thing you carry, and it is gone{kit}
  SKILL <name>    go at it another way, with one of the eighteen
  FLEE            get out"""


def fight_open(fight, carried, vitals):
    """Laid out once. The explorer keeps a session, so every blow after this one is
    a single line."""
    kit = "".join(
        f"\n                    {h['name']} — {does(h.get('effects'))}" for h in carried or []
    )
    return (
        f"{fight['name']} is on you and you are in it now. Every time you are asked, "
        "answer with one of these and nothing else:\n\n"
        + VERBS.format(weapon=fight["weapon"], weapon_damage=fight["weapon_damage"], kit=kit)
        + f"\n\nIt has {fight['health']} in it. You have {vitals.get('health')}. "
        "You will be told what happened and asked again. One word, nothing else."
    )


def fight_blow(said, fight, vitals, n):
    """One sentence, and the question again. Nothing else — the session holds the
    rest, and a fight is no place to read a briefing."""
    left = vitals.get("health", 0)
    hurt = "\n\nYou are hurt badly." if left <= FLEE_FLOOR else ""
    return (
        f"{said} {left} left of you, {fight['health']} left of it.{hurt}\n\nWhat do you do?"
    )


ENDED = {
    "beaten": "it went down.",
    "fled": "you got out.",
    "killed": "you did not get out.",
    "broken": "it is not over.",
}

BLOWS = """The fight has been rolled. They chose each of these, and this is what came of it, in order, and it is settled:

{sheet}

It ended: {ended}

What they chose is theirs, not yours — narrate the choice they made, not the one you would have made for them. Write one line for each numbered blow, in that order, second person, present tense. A line is a clause or a short sentence; this is a fight, not a chapter. Say what the numbers say. A landed blow lands and a missed one costs them. Do not soften a hit, do not add a blow, do not take one away, and do not say how it ends before the last line.

Reply in the same json shape you always use, with `blows` in place of `narration`:

    {{"blows": ["…", "…"], "claims": [], "location": "kebab-id",
     "transactions": [], "quest_open": [], "quest_update": [], "quest_close": []}}

`minutes`, `fatigue`, `health`, `check` and `fight` are not yours this time — the fight already cost what it cost. `transactions` still are: what comes off a body, what breaks, what is dropped."""

FIGHT_FATE = """The dice also went hard against them, in the doing of this. Put it in the fight, in the blow it belongs to — the strap goes, the footing goes, something arrives. Do not soften it and do not undo a blow."""

FIGHT_DEATH = """It ended: you did not get out. They are dead. Before you reply, run:

    tesbota kill "<what killed them, in a phrase>"

The last line you write is the last line of their book. Write it as one."""


def blow_line(blow, fight):
    """One row of the roll sheet: what they picked, and what it cost."""
    said = blow["chose"]
    if blow["verb"] == "ITEM":
        return (f"{said} — used, {blow.get('mended') or 'nothing changed'}; "
                f"it put {blow['taken']} into you, {blow['explorer_health']} left of you")
    if blow["verb"] == "FLEE" and blow["hit"]:
        return f"{said} — you got clear"
    if blow["verb"] == "FLEE":
        return (f"{said} — failed, it put {blow['taken']} into you, "
                f"{blow['explorer_health']} left of you")
    if blow["hit"]:
        return (f"{said} — landed, {blow['dealt']} off {fight['name']}, "
                f"{blow['enemy_health']} left of it")
    return (f"{said} — missed, it put {blow['taken']} into you, "
            f"{blow['explorer_health']} left of you")


def gm_blows(fight, fate=None):
    sheet = "\n".join(
        f"  {b['n']}  {blow_line(b, fight)}" for b in fight["blows"]
    )
    parts = [BLOWS.format(sheet=sheet, ended=ENDED.get(fight["ended"], "it is not over."))]
    if fate:
        parts.append(FIGHT_FATE)
    if fight["ended"] == "killed":
        parts.append(FIGHT_DEATH)
    return "\n\n".join(parts)


REDRAFT = (
    "Your previous draft was rejected. Revise it and reply with the same json shape. "
    "Keep everything that still stands — a redraft is a correction, not a retreat, "
    "and an answer that says less than the one before it is a worse answer, not a "
    "safer one:\n\n"
)


def gm_answer(question, previous=None, mode="look", inventory=None, others=None, correction=None, load=None, sent=None):
    parts = []
    if previous:
        parts.append(f"What they were last told:\n\n{previous}")
    if inventory:
        told(parts, sent, "inventory", "What they are carrying:",
             render_inventory(inventory, load), CARRY_SAME)
    if others:
        told(parts, sent, "others", "What everything here keeps, and it is the whole of it:",
             render_holdings(others), KEEP_SAME)

    if mode == "say":
        parts.append(
            "They are speaking. Nothing else is happening and they have not committed "
            f"to any action. They say:\n\n{question}\n\n"
            "Answer as whoever they are talking to would, in that person's voice, and "
            "narrate nothing but the reply and how it is given. Nobody moves and no "
            "bargain is struck by talking about it. If they are speaking to no one, "
            "say so. A sentence or two."
        )
    else:
        parts.append(
            "They are not doing anything yet — they are looking harder at what is "
            f"already in front of them, and they ask:\n\n{question}\n\n"
            "Answer only what can be perceived from where they stand. No time passes "
            "and nothing is done. Do not offer choices, do not move them, and do not "
            "introduce anything that would not simply be visible from here. A sentence "
            "or two."
        )
    parts.append("Reply in the same json shape, with minutes 0 and fatigue 0.")
    if correction:
        parts.append(REDRAFT + correction)
    return "\n\n".join(parts)


PRESS = """The world does not wait, and this turn it moves.

Something that was going on without the adventurer arrives. Somebody acts, something waiting stops waiting, a thread already on the table pays out — the person they were warned about finds them, the errand turns out to have been a pretext, what was in the trees comes out of the trees.

Use what is already there: an open quest, a name somebody let slip, a warning they walked past. Do not start a fresh mystery — move the one they are standing in.

It happens whether or not their action invited it, it costs them something or demands an answer, and nobody warns them first. Not luck and not weather; the dice handle those. Somebody in the world doing something on purpose. Narrate it as part of the same turn, after what they did."""


CHOSEN = """This is how the action turns out. It was rolled for, out of six ways it could have gone, and this is the one that came up:

    {text}

Narrate it as what happens. Do not hedge it, do not offer it as a possibility, and do not mention that anything was rolled. Keep the rest of the turn as it was; this replaces the outcome, not the action."""

STRANGE = """This one is strange, and that is deliberate. Put it in front of them plainly and without explanation. Nobody in the scene remarks on it, nothing accounts for it, and you do not hint at what it means — you do not know. Write it as a claim like any other and let it be ruled on."""


def gm_turn(action, previous=None, vitals=None, correction=None, event=None, left=None, arrival=None, agreed=None, note=None, chosen=None, press=False, inventory=None, others=None, quests=None, now=None, load=None, sent=None, standing=None):
    parts = []
    if now:
        parts.append(f"The time is {now}.")
    if note:
        parts.append(
            "A note from the one who keeps this world. Nobody in the story speaks it "
            "and the adventurer must never learn of it — direction, not an event:"
            f"\n\n{note}"
        )
    if agreed:
        parts.append(
            "They agreed to this, and it is settled — narrate it as happening, "
            f"and do not re-price it:\n\n{agreed['summary']}\n\n"
            f"It takes {agreed['minutes']} minutes and costs {agreed['fatigue']} fatigue. "
            "Narrate where it actually gets them. If the target was reachable in that "
            "time, they arrive. Do not tell them they are still nowhere."
        )
    if vitals:
        parts.append(
            f"Their condition: health {vitals.get('health')}/100, "
            f"fatigue {vitals.get('fatigue')}/100."
        )
    if previous:
        parts.append(f"What the adventurer was last told:\n\n{previous}")
    if arrival:
        parts.append(f"The adventurer has arrived at {arrival}. Narrate the arrival.")
    if event:
        said = (
            "Something interrupts the journey here. Invent what, and narrate it. "
            "The adventurer has been travelling and does not know how long."
        )
        if left:
            said += (
                f" The road still has {left} leagues in it: when they are done here, "
                "set them walking again with what is left."
            )
        parts.append(said)
    if inventory is not None:
        told(parts, sent, "inventory", "What they are carrying:",
             render_inventory(inventory, load), CARRY_SAME)
    if others:
        told(parts, sent, "others", "What everything here keeps, and it is the whole of it:",
             render_holdings(others), KEEP_SAME)
    if quests:
        told(parts, sent, "quests", "What they have taken on:",
             render_quests(quests), QUEST_SAME)
    if standing:
        parts.append(
            f"The fight with {standing['name']} is not over. It has {standing['health']} "
            "left in it. Declare it again with that health to carry the pool forward, or "
            "narrate it ending some other way and leave `fight` out."
        )
    if action:
        parts.append(f"The adventurer's action:\n\n{action}")
    if press:
        parts.append(PRESS)
    if chosen:
        parts.append(CHOSEN.format(text=chosen["text"]))
        if chosen.get("band") in ("epic", "legendary"):
            parts.append(STRANGE)
    if correction:
        parts.append(
            "Your previous draft was rejected. Revise it and reply with the same "
            f"json shape:\n\n{correction}"
        )
    return "\n\n".join(parts)


def lore1_query(question):
    return f"{question}"


def gm_propose(action, previous=None, vitals=None, answers=None, note=None, inventory=None, others=None, now=None, load=None):
    parts = []
    if now:
        parts.append(f"The time is {now}.")
    if note:
        parts.append(
            "A note from the one who keeps this world. Nobody in the story speaks it "
            "and the adventurer must never learn of it — direction, not an event:"
            f"\n\n{note}"
        )
    if previous:
        parts.append(f"What the adventurer was last told:\n\n{previous}")
    if vitals:
        parts.append(
            f"Their condition: health {vitals.get('health')}/100, "
            f"fatigue {vitals.get('fatigue')}/100."
        )
    if inventory is not None:
        parts.append("What they are carrying:\n" + render_inventory(inventory, load))
    if others:
        parts.append("What everything here keeps, and it is the whole of it:\n" + render_holdings(others))
    parts.append(f"What they intend to do:\n\n{action}")
    for question, answer in answers or []:
        parts.append(f"You asked: {question}\n\nThe record says: {answer}")
    return "\n\n".join(parts)


def lore1_turn(narration, where=None, now=None):
    parts = []
    if where:
        named = [w.get("name") or w.get("id") if isinstance(w, dict) else str(w) for w in where]
        parts.append("Where: " + " > ".join(n for n in named if n))
    if now:
        parts.append(f"When: {now}")
    parts.append(f"What the game master narrated:\n\n{narration}")
    parts.append("Write down what it asserts about the world.")
    return "\n\n".join(parts)


def lore2_turn(narration, facts):
    listed = "\n".join(f"- {f}" for f in facts) or "- (nothing was read out of it)"
    return (
        f"What the game master narrated:\n\n{narration}\n\n"
        f"What it asserts about the world:\n{listed}\n\n"
        "Rule on each."
    )


def lore3_turn(gap):
    return (
        "The world is silent on the following, and the silence needs to end:\n\n"
        f"{gap}\n\n"
        "Talk it through with me first. Look up whatever already exists before "
        "proposing anything. When we agree, write the documents."
    )


def questmaster_turn(quest, where=None):
    parts = [f"The errand: {quest.get('title')}"]
    if quest.get("detail"):
        parts.append(f"As it was put to them: {quest['detail']}")
    if quest.get("giver"):
        parts.append(f"Set by: {quest['giver']}")
    if where:
        named = [w.get("name") or w.get("id") if isinstance(w, dict) else str(w) for w in where]
        parts.append("Taken on at: " + " > ".join(n for n in named if n))
    parts.append("Read what the world already says about any of this, then write the script.")
    return "\n\n".join(parts)


LAYERS = (
    ("common", "common", "READING"),
    ("writing", "writing", "LORE_WRITING"),
    ("explorer", "explorer", "EXPLORER_SYSTEM"),
    ("gm", "game master", "GM_SYSTEM"),
    ("propose", "propose", "GM_PROPOSE_SYSTEM"),
    ("lore1", "lore 1", "LORE1_SYSTEM"),
    ("lore2", "lore 2", "LORE2_SYSTEM"),
    ("queries", "queries", "LORE1_QUERY_SYSTEM"),
    ("lore3", "lore 3", "LORE3_SYSTEM"),
    ("lore4", "lore 4", "LORE4_SYSTEM"),
    ("questmaster", "questmaster", "QUESTMASTER_SYSTEM"),
)


def catalogue():
    """Every prompt as it is written on disk — the shared blocks stay a pointer to
    the tab that holds them rather than repeated under each agent."""
    out = []
    for key, label, _ in LAYERS:
        raw = (PROMPTS / f"{key}.md").read_text()
        out.append({"id": key, "label": label, "text": fill(raw), "source": raw})
    return out
