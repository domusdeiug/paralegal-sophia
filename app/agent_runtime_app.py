# app/agent_runtime_app.py
import os
from google.adk.agents.run_config import StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai.types import Content, Part

from .agent import root_agent


class AgentRuntime:
    def __init__(self):
        self._runner = Runner(
            agent=root_agent,
            app_name="sophia-paralegal",
            session_service=InMemorySessionService(),
        )

    def query(self, *, user_id: str, session_id: str, message: str) -> str:
        """Synchronous query — used by Agent Engine."""
        import asyncio
        return asyncio.get_event_loop().run_until_complete(
            self.async_query(user_id=user_id, session_id=session_id, message=message)
        )

    async def async_query(self, *, user_id: str, session_id: str, message: str) -> str:
        """Async query."""
        session_service = self._runner.session_service
        session = await session_service.get_session(
            app_name="sophia-paralegal",
            user_id=user_id,
            session_id=session_id,
        )
        if session is None:
            session = await session_service.create_session(
                app_name="sophia-paralegal",
                user_id=user_id,
                session_id=session_id,
                state={"user_id": user_id},
            )

        content = Content(role="user", parts=[Part(text=message)])
        response_text = ""
        async for event in self._runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=content,
        ):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        response_text += part.text
        return response_text


agent_runtime = AgentRuntime()