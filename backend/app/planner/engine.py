import os
import json
import httpx
from dotenv import load_dotenv

load_dotenv()

class GeminiPlannerEngine:
    def __init__(self):
        self.api_key = os.getenv("OPENROUTER_API_KEY")
        self.api_base = os.getenv("OPENROUTER_API_BASE", "https://openrouter.ai/api/v1")
        self.model = os.getenv("LLM_MODEL", "google/gemini-2.5-pro")

    async def generate_repo_summary(self, repo_name: str, parsed_files: dict, graph_stats: dict) -> str:
        """
        Calls Gemini to create a structured architectural summary of the repository
        based on parsed codebase metadata.
        """
        if not self.api_key:
            return "Gemini API key is missing. Cannot generate repository summary."

        truncated_files = {}
        for path, info in list(parsed_files.items())[:100]:
            truncated_files[path] = {
                "classes": info.get("classes", []),
                "functions": info.get("functions", []),
                "routes": info.get("routes", []),
                "db_calls": info.get("db_calls", []),
                "size_bytes": info.get("size_bytes", 0)
            }

        prompt = f"""
You are the Lead Architect for RepoScope. Generate an architectural summary for the repository '{repo_name}'.
You are given file statistics and parsed structures.

GRAPH METRICS:
{json.dumps(graph_stats, indent=2)}

PARSED FILES METADATA:
{json.dumps(truncated_files, indent=2)}

Create a concise Markdown report containing:
1. **Overview**: High-level system architecture and style (Monolith/Microservices, MVC, etc.).
2. **Main Business Domains**: What domains exist in the code (e.g. Users, Payments, Auth).
3. **Critical Modules**: Highly connected/frequently imported files.
4. **Possible Architectural Bottlenecks / Tech Debt**: Any circular dependency risks, missing layers, or database couplings.

Keep it direct, professional, and descriptive.
"""
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}]
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_base}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=45.0
                )
                response.raise_for_status()
                result = response.json()
                return result["choices"][0]["message"]["content"]
        except Exception as e:
            return f"Failed to generate repository summary: {str(e)}"

    async def _call_llm(self, prompt: str) -> str:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}]
        }
        
        print(f"[Planner] Sending request to OpenRouter with model {self.model}...")
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_base}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=120.0
                )
                response.raise_for_status()
                result = response.json()
                content = result["choices"][0]["message"]["content"]
                return content
        except Exception as e:
            print(f"[Planner] Error during OpenRouter request: {e}")
            return f"Failed to generate: {str(e)}"

    async def generate_plan_sections_stream(
        self, 
        query: str, 
        repo_summary: str, 
        clarification_answers: dict, 
        subgraph_context: dict
    ):
        """
        Generates an engineering plan report sequentially, yielding sections as they complete.
        """
        if not self.api_key:
            yield json.dumps({"error": "Gemini API key is missing. Cannot generate engineering plan."})
            return

        clarifications_str = "\n".join([f"- {k}: {v}" for k, v in clarification_answers.items()])
        
        base_context = f"""
REFACTORING REQUEST:
"{query}"

REPOSITORY ARCHITECTURAL SUMMARY:
{repo_summary}

USER CLARIFICATION ANSWERS (Business Constraints):
{clarifications_str}

RELEVANT KNOWLEDGE GRAPH SUBGRAPH (Node dependencies and connections):
{json.dumps(subgraph_context, indent=2)}
"""

        # 1. Executive Summary & Affected Components
        prompt_1 = f"""
You are a Staff Software Engineer and Architect. Generate the Executive Summary and Affected Components for the refactoring query below.

{base_context}

Output MUST be in Markdown format and include these sections exactly:

# Executive Summary
- Feasibility: [Feasible / Infeasible]
- Risk: [Low / Medium / High]
- Confidence: [e.g. 86%]

# Affected Components
List files, APIs, workers, databases, queues, or middleware affected by this change. Format each item on a separate line.
"""
        yield json.dumps({"status": "Generating Executive Summary..."})
        exec_summary = await self._call_llm(prompt_1)
        yield json.dumps({"section": "executive_summary", "content": exec_summary})

        # 2. Suggested Plan (Phases)
        prompt_2 = f"""
You are a Staff Software Engineer and Architect. We already generated the Executive Summary for the refactoring query.
Now, generate the Suggested Plan (execution phases).

{base_context}

Output MUST be in Markdown format and include this section exactly:

# Suggested Plan
Detailed step-by-step phases mapping out exactly how to execute the change. Use Phase names and show flow transitions:
Phase 1: [Name] -> Phase 2: [Name] -> Phase 3: [Name] -> Phase 4: [Name] -> Phase 5: [Name]

Do NOT write code blocks implementing the actual application code. Focus entirely on the engineering strategy, dependency mappings, and migration steps.
"""
        yield json.dumps({"status": "Drafting Execution Phases..."})
        phases = await self._call_llm(prompt_2)
        yield json.dumps({"section": "phases", "content": phases})

        # 3. Risks & Open Questions
        prompt_3 = f"""
You are a Staff Software Engineer and Architect. We are generating a plan for the refactoring query.
Generate the Risks and Open Questions sections.

{base_context}

Output MUST be in Markdown format and include these sections exactly:

# Risks
List technical risks of this change (e.g. session expiration, database locks).

# Open Questions
List remaining variables that require verification or decisions.
"""
        yield json.dumps({"status": "Identifying Risks & Open Questions..."})
        risks = await self._call_llm(prompt_3)
        yield json.dumps({"section": "risks_questions", "content": risks})

        # 4. Confidence & Reasoning
        prompt_4 = f"""
You are a Staff Software Engineer and Architect. We are generating a plan for the refactoring query.
Generate the Confidence and Reasoning sections based on the decisions made so far.

{base_context}

Output MUST be in Markdown format and include these sections exactly:

# Confidence
Breakdown of the confidence score (e.g. 86% because: - Reasons). Include what files or inputs could increase this confidence.

# Explain the Reasoning
Detail the architectural rationale answering these specific subheadings:
- **Why this plan?**
- **Why these risks?**
- **Why these assumptions?**
- **Why this confidence?**
- **Why these questions?**
"""
        yield json.dumps({"status": "Formulating Reasoning..."})
        reasoning = await self._call_llm(prompt_4)
        yield json.dumps({"section": "reasoning", "content": reasoning})
