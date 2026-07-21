# Architecture Specification — RepoScope

This document outlines the detailed system flow, data models, and component boundaries of RepoScope.

---

## 1. Request Flow & Pipelines

### Clone & Parse Pipeline
```text
User Input URL ──► Clone Repository ──► AST Parser (Python ast) ──► NetworkX Builder ──► Save JSON Graph
```

### Planning & Evaluation Pipeline
```text
Query ──► Router ──► (Clarify?) ──► Gemini Planner ──► Raw Plan ──► Graph Evaluator ──► Final Scored Report
```

---

## 2. Component Boundaries

### Parser (backend/app/parser)
- **Responsibility**: Analyzes code files statically.
- **Technology**: Native Python `ast` module (robust, standard) and regex/tree-sitter fallbacks.
- **Output**: List of dictionaries containing node definitions and extracted import/call relationships.

### Graph Engine (backend/app/graph)
- **Responsibility**: Constructs, queries, and stores the Knowledge Graph.
- **Technology**: NetworkX.
- **Output**: JSON representation of the graph:
  ```json
  {
    "nodes": [{"id": "users.py", "type": "file", "size": 1024}, ...],
    "links": [{"source": "users.py", "target": "auth.py", "type": "imports"}]
  }
  ```

### Planner & Router (backend/app/planner)
- **Responsibility**: Directs request routing and calls the Gemini API (using OpenRouter endpoint configurations).
- **Sub-components**:
  - **Decision Router**: Classifies the incoming query and outputs structured JSON determining the routing behavior.
  - **Planning Engine**: Prompts Gemini using the target subgraph and structural context.

### Evaluator (backend/app/evaluator)
- **Responsibility**: Assesses planning quality and accuracy.
- **Logic**: Compares files listed in the "Affected Components" section of the plan report against descendants/ancestors of target nodes in the NetworkX graph.

---

## 3. Data Schema Specifications

### Node Schema
- `id` (string, unique path/symbol name)
- `type` (string: `file`, `directory`, `class`, `function`, `api`, `database`, `queue`)
- `properties` (dict: lines of code, route path, database tables)

### Edge Schema
- `source` (string, node ID)
- `target` (string, node ID)
- `type` (string: `imports`, `calls`, `reads_from`, `writes_to`, `depends_on`, `publishes`, `subscribes`)
