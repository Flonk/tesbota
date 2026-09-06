SHELL = ";|&$`><\n"


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


def sqlite_gate(readonly=True):
    async def gate(tool_name, tool_input, context):
        from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

        how = 'sqlite3 -readonly canon.db "SELECT ..."' if readonly else 'sqlite3 canon.db "..."'
        if tool_name != "Bash":
            return PermissionResultDeny(message=f"The world is only reachable with {how}")
        raw = (tool_input or {}).get("command") or ""
        if any(ch in bare(raw) for ch in SHELL):
            return PermissionResultDeny(
                message=f"One command at a time, with no shell around it: {how}"
            )
        words = raw.strip().split()
        if not words or words[0] != "sqlite3":
            return PermissionResultDeny(message=f"The only command you have is {how}")
        if readonly and "-readonly" not in words:
            return PermissionResultDeny(
                message=f"You read the world, you never write to it: {how}"
            )
        return PermissionResultAllow()

    return gate
