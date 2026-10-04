"""A run's working state, stored as JSON on the run (`agent_runs.state`).

A run stops whenever it waits for the user (a question, or a write tool to confirm), and the
next job, in any worker process, picks it up from here alone:
- `messages`: the conversation the model sees, with tool calls (and their provider signatures)
  and results;
- `memory`: the run memory's snapshot (short ids F1/H1/P1 and the supplier ids behind them);
- `memo`: answers to calls already made (same tool and arguments), so a repeated call is not run
  again;
- `user_texts`: what the user typed (the prompt and replies), whose values the guard accepts;
  never the engine's own re-prompt;
- `pending`: the question or confirmation the run waits on, with the turn's results so far and
  the calls still to run; `inbox`: the user's answer to it, left by the API for the next job;
- counters: model calls made (`turns`), whether the one re-prompt was used, running time so far
  (`elapsed_s`, which excludes time spent waiting for the user), when the run was last queued
  (`queued_at`) and when a job last claimed it (`running_at`: the stuck-run sweeper's measure of
  a running run's last activity, with its newest step).

The state holds supplier ids (in the memory): it never leaves the server.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from travelmind.agent.context import RunMemory
from travelmind.agent.provider import Message, ToolCall, ToolResult

STATE_VERSION = 1


def call_to_json(call: ToolCall) -> dict[str, Any]:
    return {"id": call.id, "name": call.name, "args": call.args, "signature": call.signature}


def call_from_json(data: dict[str, Any]) -> ToolCall:
    return ToolCall(
        id=str(data["id"]),
        name=str(data["name"]),
        args=dict(data.get("args") or {}),
        signature=data.get("signature"),
    )


def result_to_json(result: ToolResult) -> dict[str, Any]:
    return {"call_id": result.call_id, "name": result.name, "data": result.data}


def result_from_json(data: dict[str, Any]) -> ToolResult:
    return ToolResult(
        call_id=str(data["call_id"]), name=str(data["name"]), data=dict(data.get("data") or {})
    )


def message_to_json(message: Message) -> dict[str, Any]:
    return {
        "role": message.role,
        "text": message.text,
        "text_signature": message.text_signature,
        "calls": [call_to_json(c) for c in message.calls],
        "results": [result_to_json(r) for r in message.results],
    }


def message_from_json(data: dict[str, Any]) -> Message:
    return Message(
        role=data["role"],
        text=data.get("text"),
        calls=tuple(call_from_json(c) for c in data.get("calls") or []),
        results=tuple(result_from_json(r) for r in data.get("results") or []),
        text_signature=data.get("text_signature"),
    )


@dataclass
class RunState:
    messages: list[Message] = field(default_factory=list)
    memory: RunMemory = field(default_factory=RunMemory)
    memo: dict[str, dict[str, Any]] = field(default_factory=dict)
    user_texts: list[str] = field(default_factory=list)
    pending: dict[str, Any] | None = None
    inbox: dict[str, Any] | None = None
    turns: int = 0
    reprompted: bool = False
    elapsed_s: float = 0.0
    queued_at: datetime | None = None
    running_at: datetime | None = None

    @classmethod
    def start(cls, prompt: str, now: datetime) -> "RunState":
        return cls(messages=[Message(role="user", text=prompt)], user_texts=[prompt], queued_at=now)

    def results(self) -> list[ToolResult]:
        return [result for message in self.messages for result in message.results]

    def to_json(self) -> dict[str, Any]:
        return {
            "version": STATE_VERSION,
            "messages": [message_to_json(m) for m in self.messages],
            "memory": self.memory.snapshot(),
            "memo": self.memo,
            "user_texts": self.user_texts,
            "pending": self.pending,
            "inbox": self.inbox,
            "turns": self.turns,
            "reprompted": self.reprompted,
            "elapsed_s": self.elapsed_s,
            "queued_at": self.queued_at.isoformat() if self.queued_at else None,
            "running_at": self.running_at.isoformat() if self.running_at else None,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any] | None) -> "RunState":
        data = data or {}
        queued, running = data.get("queued_at"), data.get("running_at")
        return cls(
            messages=[message_from_json(m) for m in data.get("messages") or []],
            memory=RunMemory.restore(data.get("memory")),
            memo=dict(data.get("memo") or {}),
            user_texts=[str(t) for t in data.get("user_texts") or []],
            pending=data.get("pending"),
            inbox=data.get("inbox"),
            turns=int(data.get("turns") or 0),
            reprompted=bool(data.get("reprompted")),
            elapsed_s=float(data.get("elapsed_s") or 0.0),
            queued_at=datetime.fromisoformat(queued) if isinstance(queued, str) else None,
            running_at=datetime.fromisoformat(running) if isinstance(running, str) else None,
        )
