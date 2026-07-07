"""Infer the customer/account a demo is being built FOR, from the chat.

A cheap mini-model pass over the conversation. The field engineer usually names
the real customer somewhere in chat ("let's build this for Acme's fraud team");
we capture that onto `Project.customer` so it's visible centrally. Null stays
null — the UI renders "Not specified" — and we never invent a name.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import Engine
from sqlmodel import Session, select

from ..core._config import AppConfig
from ..models import Message, Project
from .llm_service import LLMService, ModelSize

logger = logging.getLogger(__name__)

# Cap how much conversation we send the mini model (keep the tail — the most
# recent turns are the likeliest to name the customer).
_MAX_CHARS = 12000

# Bound the cost: only attempt inference over the opening stretch of a
# conversation. Customers are almost always named early ("build this for
# <Account>"), so past this many user turns we stop auto-inferring rather than
# pay a mini-model call on EVERY turn of a project that never names one. The
# user can always set the customer manually from the workspace chip.
_MAX_INFERENCE_TURNS = 8

# Values a model sometimes returns to mean "nothing" — treat all as no-customer.
_NULLISH = {"null", "none", "n/a", "na", "not specified", "unknown", "unspecified", ""}


def infer_customer(llm: LLMService, conversation_text: str) -> Optional[str]:
    """Return the customer/account named in the conversation, or None.

    Conservative: only returns a name the user clearly stated; the fictional
    company inside the demo story is explicitly NOT treated as the customer.
    """
    text = (conversation_text or "").strip()
    if not text:
        return None

    prompt = (
        "A Databricks field engineer is building a demo, usually to present to a "
        "specific CUSTOMER / ACCOUNT / prospect. From the conversation, extract "
        "the name of the customer the demo is being built FOR or presented TO, if "
        "the user states it. Cues that introduce the customer: 'for <Name>', "
        "'meeting with <Name>', 'prepping for <Name>', '<Name> wants/asked for', "
        "'the <Name> account/deal'. Capture that name even if it sounds generic.\n"
        "Do NOT return a company that only appears INSIDE the demo's story/data "
        "(e.g. 'a demo about a retailer called X', or a synthetic company in the "
        "scenario) — that is not the customer. If no customer/account is stated, "
        "return null. Never invent a name.\n\n"
        'Return strict JSON: {"customer": "<name>"} or {"customer": null}.\n\n'
        f"Conversation:\n{text[-_MAX_CHARS:]}"
    )

    try:
        result = llm.chat_json(prompt, size=ModelSize.MINI, max_tokens=100)
    except Exception as e:  # non-fatal — inference is best-effort
        logger.debug(f"customer inference call failed: {e}")
        return None

    val = result.get("customer") if isinstance(result, dict) else None
    if not isinstance(val, str):
        return None
    val = val.strip()
    if val.lower() in _NULLISH:
        return None
    return val[:255]


def maybe_update_project_customer(project_id: str, engine: Engine, config: AppConfig) -> None:
    """Infer + persist `Project.customer` from the conversation.

    Runs only while the customer is still unset (first clear mention wins, which
    bounds cost — once set we stop calling the model). Fully non-fatal: any error
    is swallowed so it can never affect the chat flow. Meant to be called
    fire-and-forget off a worker thread after an agent turn.
    """
    try:
        from databricks.sdk import WorkspaceClient

        with Session(engine) as db:
            project = db.get(Project, project_id)
            if not project or (project.customer or "").strip():
                return  # gone, or customer already known — nothing to do

            # Only the USER's messages carry the real-customer signal; assistant
            # turns describe the (fictional) demo and would mislead the model.
            msgs = db.exec(
                select(Message)
                .where(Message.project_id == project_id)
                .where(Message.role == "user")
                .order_by(Message.created_at)
            ).all()
            # Only worth an LLM pass over the opening turns (see _MAX_INFERENCE_TURNS).
            # Past that, stop auto-inferring so a long conversation that never
            # names a customer doesn't cost a mini-model call every single turn.
            if len(msgs) > _MAX_INFERENCE_TURNS:
                return
            convo = "\n".join(m.content for m in msgs if m.content)
            if not convo.strip():
                return

            llm = LLMService(WorkspaceClient(), config)
            customer = infer_customer(llm, convo)
            if customer:
                project.customer = customer
                db.add(project)
                db.commit()
                logger.info(f"[customer] project {project_id}: inferred '{customer}'")
    except Exception as e:  # never let this affect the caller
        logger.debug(f"maybe_update_project_customer failed for {project_id}: {e}")
