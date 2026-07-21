# API Specifications — RepoScope

This document outlines the API endpoints exposed by the FastAPI backend (`http://localhost:8000`).

---

## 1. Import Repository
Clones a repository and extracts its structure.

* **Endpoint**: `POST /api/import`
* **Request Body**:
  ```json
  {
    "github_url": "https://github.com/example/my-repo",
    "branch": "main"
  }
  ```
* **Response**:
  ```json
  {
    "status": "success",
    "repo_name": "my-repo",
    "nodes_count": 42,
    "edges_count": 105
  }
  ```

---

## 2. Retrieve Graph
Returns the serialized NetworkX knowledge graph.

* **Endpoint**: `GET /api/graph`
* **Response**:
  ```json
  {
    "nodes": [
      { "id": "users.py", "type": "file", "labels": ["auth"] }
    ],
    "links": [
      { "source": "users.py", "target": "database.py", "type": "writes_to" }
    ]
  }
  ```

---

## 3. Query Decision Router
Analyzes if the query requires planning, retrieval, or user clarification.

* **Endpoint**: `POST /api/route`
* **Request Body**:
  ```json
  {
    "query": "Split UserService into a separate service"
  }
  ```
* **Response**:
  ```json
  {
    "need_planning": true,
    "need_retrieval": true,
    "need_clarification": true,
    "clarification_questions": [
      {
        "id": "zero_downtime",
        "question": "Is zero-downtime required?",
        "options": ["Yes", "No"]
      }
    ],
    "reasoning": "Splitting a core service requires knowing service boundaries and deployment downtime tolerances."
  }
  ```

---

## 4. Generate & Evaluate Plan
Generates the architectural plan and runs the evaluation harness.

* **Endpoint**: `POST /api/plan`
* **Request Body**:
  ```json
  {
    "query": "Split UserService into a separate service",
    "clarifications": {
      "zero_downtime": "Yes"
    }
  }
  ```
* **Response**:
  ```json
  {
    "plan_markdown": "# Engineering Plan ...",
    "evaluation": {
      "score": 92,
      "checks": {
        "dependency_coverage": true,
        "rollback_included": true
      },
      "feedback": "Excellent plan. Zero downtime steps correctly detailed."
    }
  }
  ```
