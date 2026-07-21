# RepoScope — AI Repository Planning Engine

> **Repository Intelligence for Engineering Planning**
> An experimental system that builds a structured understanding of a codebase statically and uses it to generate reliable, hallucination-free engineering plans for architectural changes.

---

## What is RepoScope?

Most AI coding assistants try to write code directly or operate in a chat interface with limited context. When tasked with complex, high-level architectural changes (e.g., "migrate from MongoDB to PostgreSQL" or "extract notifications into a microservice"), they often struggle with missing context, hallucinations, or suggesting plans that break dependency boundaries.

RepoScope solves this by decoupling the codebase understanding from the AI:
1. **Deterministic Parsing**: Statically analyzes the codebase using AST parsers and syntax trees to extract exact relationships (imports, calls, read/write actions).
2. **Knowledge Graph Builder**: Constructs a dependency graph modeling how everything connects.
3. **Decision Router**: Classifies the planning request, deciding what context is needed and whether human input/clarification is required.
4. **Planning & Evaluation Engine**: Utilizes Gemini to reason over the graph topology and generates a step-by-step implementation report, which is then double-checked against the graph dependencies by an evaluation harness.

---

## Core Features

- **No-AI Codebase Parsing**: Fast, language-agnostic extraction of classes, functions, routes, and APIs using AST and tree-sitter.
- **Dependency Graph Visualizer**: A Next.js and React Flow interface that maps project structure, directories, files, and their explicit dependencies.
- **Decision Router**: Analyzes your engineering query to determine scope, retrieval needs, and if clarifications are required.
- **Structured Engineering Reports**: Generates multi-phase migration and refactoring steps, identifying affected files, risks, and rollbacks.
- **Self-Critiquing Evaluation**: Measures plan quality against the dependency graph to assign a final confidence score.

---

## Quick Start

### Backend
1. Go to the `backend` directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Set up your `.env` (API keys):
   ```bash
   cp .env.example .env
   ```
4. Run the FastAPI development server:
   ```bash
   uvicorn app.main:app --reload
   ```

### Frontend
1. Go to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the Next.js development server:
   ```bash
   npm run dev
   ```

---

## System Architecture

```text
GitHub/Local Repo
        │
        ▼
Parser Engine (AST/Tree-sitter)
        │
        ▼
Knowledge Graph (NetworkX) ───► Interactive Dependency Explorer (React Flow)
        │
        ▼
Decision Router (Gemini)
        │ (Needs Clarification?)
        ├───► User Clarification (UI Form)
        │
        ▼
Planning Engine (Gemini)
        │
        ▼
Engineering Plan Report
        │
        ▼
Evaluation Harness ───► Score & Plan Critique
```
