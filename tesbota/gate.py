import re

SHELL = ";|&$`><\n"

WRITE_TARGET = re.compile(
    r"\b(?:insert(?:\s+or\s+\w+)?\s+into|update|delete\s+from|replace\s+into)\s+([a-z_][a-z_0-9]*)",
    re.I,
)
SCHEMA_VERB = re.compile(r"\b(?:drop|alter|create|attach|detach|vacuum|pragma)\b", re.I)


def bare(raw):
    out, quote = [], None
    for ch in raw:
        if quote:
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
            continue
        out.append(ch)
    return "".join(out)


def spoken(raw):
    words = (raw or "").strip().split()
    if words[:2] == ["uv", "run"]:
        words = words[2:]
    return words


def sqlite_gate(readonly=True, tables=None, also=()):
    async def gate(tool_name, tool_input, context):
        from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

        how = 'sqlite3 -readonly canon.db "SELECT ..."' if readonly else 'sqlite3 canon.db "..."'
        if tool_name != "Bash":
            return PermissionResultDeny(message=f"The world is only reachable with {how}")
        raw = (tool_input or {}).get("command") or ""
        stripped = bare(raw)
        if any(ch in stripped for ch in SHELL):
            return PermissionResultDeny(
                message=f"One command at a time, with no shell around it: {how}"
            )
        said = spoken(raw)
        for command in also:
            if said[:len(command.split())] == command.split():
                return PermissionResultAllow()
        words = raw.strip().split()
        if not words or words[0] != "sqlite3":
            return PermissionResultDeny(message=f"The only command you have is {how}")
        if readonly and "-readonly" not in words:
            return PermissionResultDeny(
                message="You read the world, you never write to it: "
                f'sqlite3 -readonly canon.db "SELECT ..."'
            )
        if tables is not None and "-readonly" not in words:
            allowed = ", ".join(tables)
            if SCHEMA_VERB.search(stripped):
                return PermissionResultDeny(
                    message=f"You do not shape the world, you write in it. Only {allowed}."
                )
            touched = {t.lower() for t in WRITE_TARGET.findall(stripped)}
            outside = sorted(touched - set(tables))
            if outside:
                return PermissionResultDeny(
                    message=(
                        f"That is not yours to write: {', '.join(outside)}. "
                        f"You write to {allowed} and nothing else."
                    )
                )
        return PermissionResultAllow()

    return gate
