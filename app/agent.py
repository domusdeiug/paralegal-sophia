import os
from google.adk.agents import LlmAgent
from google.adk.tools.agent_tool import AgentTool

from .tools.laws_africa import search_laws_africa
from .tools.corpus_search import search_legal_corpus
from .tools.case_db import read_cases_db
from .tools.web_search import web_search
from .tools.docx_gen import generate_docx
from .tools.supabase_writer import write_result

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

# ---------------------------------------------------------------------------
# Sub-agents
# ---------------------------------------------------------------------------

research_agent = LlmAgent(
    name="ResearchAgent",
    model=GEMINI_MODEL,
    description=(
        "Searches Ugandan case law from Laws.Africa and the user's private legal corpus. "
        "Use for legal precedents, judgments, and research on legal topics."
    ),
    instruction=(
        "You are a legal research specialist. Search for relevant Ugandan judgments and "
        "the user's private legal corpus to find case law, precedents, and legal authorities. "
        "Return well-organised findings with citations."
    ),
    tools=[search_laws_africa, search_legal_corpus],
)

case_agent = LlmAgent(
    name="CaseAgent",
    model=GEMINI_MODEL,
    description=(
        "Reads the user's case database records and searches the web for recent legal developments. "
        "Use when the user asks about specific clients, file numbers, or current news."
    ),
    instruction=(
        "You are a case management specialist. Look up the user's case records and search the web "
        "for current developments relevant to the query. Return clear, factual summaries."
    ),
    tools=[read_cases_db, web_search],
)

drafting_agent = LlmAgent(
    name="DraftingAgent",
    model=GEMINI_MODEL,
    description=(
        "Drafts formal Ugandan court submissions in proper legal format and produces a Word document. "
        "Only call when the user explicitly wants a document drafted."
    ),
    instruction=(
        "You are an expert Ugandan legal drafter. Using the context provided, produce a complete, "
        "formal court submission in proper Ugandan court format. Write in clear legal English with "
        "proper headings, citations, and a prayers/relief section. Then call generate_docx to save "
        "the document and return the download URL."
    ),
    tools=[generate_docx],
)

# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

orchestrator_agent = LlmAgent(
    name="OrchestratorAgent",
    model=GEMINI_MODEL,
    description="Root orchestrator for the Sophia Ugandan paralegal assistant.",
    instruction="""You are Sophia, an expert Ugandan paralegal assistant.

For conversational legal questions:
- Delegate to ResearchAgent for case law and precedents
- Delegate to CaseAgent for specific client cases or current news
- Use at most 2 sub-agent calls per response
- Synthesize results into a clear direct answer
- Finally, use the write_result tool to save the results to the database.

For document drafting requests:
- Delegate to ResearchAgent to gather legal authorities
- Delegate to CaseAgent if a specific client is mentioned
- Pass gathered context to DraftingAgent to produce the Word document
- Return the download URL with a short summary
- Finally, use the write_result tool to save the results to the database.

For simple general questions, answer directly without delegating.""",
    tools=[
        AgentTool(agent=research_agent),
        AgentTool(agent=case_agent),
        AgentTool(agent=drafting_agent),
        write_result,
    ],
)

root_agent = orchestrator_agent
