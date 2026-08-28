import asyncio
import json
import re
import time
import warnings

from .config import ROOT

warnings.filterwarnings("ignore", message=".*can_use_tool.*")
warnings.filterwarnings("ignore", category=UserWarning, module="claude_agent_sdk.*")

FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


class AgentError(RuntimeError):
    pass


CLOSERS = set(",:}]")


def mend(raw):
    """Escape the bare double quotes a game master leaves around spoken words."""
    out = []
    inside = False
    escaped = False
    for i, ch in enumerate(raw):
        if escaped:
            out.append(ch)
            escaped = False
            continue
        if ch == "\\":
            out.append(ch)
            escaped = True
            continue
        if ch == '"':
            if not inside:
                inside = True
                out.append(ch)
                continue
            rest = raw[i + 1:].lstrip()
            if not rest or rest[0] in CLOSERS:
                inside = False
                out.append(ch)
            else:
                out.append('\\"')
            continue
        out.append(ch)
    return "".join(out)


def extract_json(text):
    match = FENCE.search(text or "")
    raw = match.group(1) if match else (text or "")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as first:
        try:
            return json.loads(mend(raw))
        except json.JSONDecodeError:
            raise AgentError(
                f"agent did not return parseable json: {first}\n\n{text}"
            ) from first


async def _ask(prompt, system, tools, session, model, permission=None):
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeAgentOptions,
        ResultMessage,
        TextBlock,
        query,
    )

    options = ClaudeAgentOptions(
        system_prompt=system,
        allowed_tools=list(tools),
        permission_mode="acceptEdits",
        resume=session,
        cwd=str(ROOT),
        model=model,
        can_use_tool=permission,
    )

    chunks = []
    session_id = session
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            chunks += [b.text for b in message.content if isinstance(b, TextBlock)]
        elif isinstance(message, ResultMessage):
            session_id = message.session_id
    return "\n".join(chunks).strip(), session_id


def ask(prompt, *, system, tools=(), session=None, model=None, attempts=2, permission=None):
    last = None
    for attempt in range(attempts):
        try:
            return asyncio.run(_ask(prompt, system, tools, session, model, permission))
        except Exception as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(2)
    raise AgentError(f"agent call failed after {attempts} attempts: {last}") from last
