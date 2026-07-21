import os
import json
import httpx
from dotenv import load_dotenv

load_dotenv()

class DecisionRouter:
    def __init__(self):
        self.api_key = os.getenv("OPENROUTER_API_KEY")
        self.api_base = os.getenv("OPENROUTER_API_BASE", "https://openrouter.ai/api/v1")
        self.model = os.getenv("LLM_MODEL", "google/gemini-2.5-pro")

    async def route_query(self, query: str, graph_summary: str) -> dict:
        """
        Uses Gemini to classify the refactoring request and decide next steps:
        - Need repository graph?
        - Need retrieval?
        - Need planning?
        - Need multiple agents?
        - Need human clarification?
        - Need code generation?
        """
        if not self.api_key:
            return {
                "error": "GEMINI_OPENROUTER_API_KEY is not configured in .env",
                "need_graph": False,
                "need_retrieval": False,
                "need_planning": False,
                "need_multiple_agents": False,
                "need_clarification": False,
                "need_code_generation": False,
                "clarification_questions": [],
                "reasoning": "API Key is missing."
            }

        prompt = f"""
You are the Decision Router for RepoScope, an engineering planning engine.
Analyze the user's architectural refactoring request and the summary of the repository graph.
Decide:
1. Do we need the repository graph? (e.g. to trace dependencies)
2. Do we need retrieval? (e.g. reading file contents)
3. Do we need planning? (e.g. generating a step-by-step engineering plan)
4. Do we need multiple agents? (e.g. complex multi-step code editing workflows - usually false for high level planning)
5. Do we need human clarification? (e.g. missing zero-downtime, data migration requirements)
6. Do we need code generation? (usually false since this is a planning tool, not an AI coder)

If human clarification is needed, generate 1 to 3 structured multiple-choice clarification questions.

REPOSITORY KNOWLEDGE GRAPH SUMMARY:
{graph_summary}

USER REFACTORING REQUEST:
"{query}"

Return a JSON object matching this schema exactly:
{{
  "need_graph": boolean,
  "need_retrieval": boolean,
  "need_planning": boolean,
  "need_multiple_agents": boolean,
  "need_clarification": boolean,
  "need_code_generation": boolean,
  "clarification_questions": [
    {{
      "id": "unique_question_id",
      "question": "Clear question text?",
      "options": ["Option A", "Option B", "Option C"]
    }}
  ],
  "reasoning": "Clear explanation of why each decision was made."
}}
"""

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"}
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_base}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=30.0
                )
                response.raise_for_status()
                result = response.json()
                content = result["choices"][0]["message"]["content"]
                return json.loads(content)
        except Exception as e:
            return {
                "error": f"Failed to call Decision Router LLM: {str(e)}",
                "need_graph": True,
                "need_retrieval": False,
                "need_planning": True,
                "need_multiple_agents": False,
                "need_clarification": False,
                "need_code_generation": False,
                "clarification_questions": [],
                "reasoning": f"Exception encountered: {str(e)}"
            }
