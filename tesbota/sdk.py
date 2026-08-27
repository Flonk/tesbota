import asyncio
import json
import re

from .config import ROOT

FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


class AgentError(RuntimeError):
    pass


def extract_json(text):
    match = FENCE.search(text or "")
    raw = match.group(1) if match else (text or "")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AgentError(f"agent did not return parseable json: {exc}\n\n{text}") from exc


async def _ask(prompt, system, tools, session, model):
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
    )

    chunks = []
    session_id = session
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            chunks += [b.text for b in message.content if isinstance(b, TextBlock)]
        elif isinstance(message, ResultMessage):
            session_id = message.session_id
    return "\n".join(chunks).strip(), session_id


def ask(prompt, *, system, tools=(), session=None, model=None):
    return asyncio.run(_ask(prompt, system, tools, session, model))
