# Architectural Decisions Record (ADR) — RepoScope

## Decision #1: Use NetworkX Graph instead of Vector Databases

### Context
We need to capture how files, classes, functions, and databases depend on each other. If a user asks "Split UserService into a microservice", we must find all modules importing `UserService` or calling its methods.

### Decision
We use **NetworkX** to construct a deterministic Directed Graph (DiGraph) instead of embeddings in a Vector Database.

### Rationale
- **Vector search** is semantic and probabilistic. It cannot guarantee finding all functions calling a specific endpoint.
- **NetworkX** allows exact reachability queries (e.g. `nx.descendants(G, 'UserService')`) with mathematical certainty.
- NetworkX is entirely Python-in-memory, requiring no external databases/Docker instances (like Neo4j) to run.

---

## Decision #2: Single Planning Agent instead of Multi-Agent CrewAI/LangGraph

### Context
Modern AI engineering platforms often orchestrate multiple agents (e.g., CodeAgent, PlannerAgent, ReviewAgent).

### Decision
We use a **Single Planning Agent** coupled with a structured classification layer (Decision Router) and a deterministic validator (Evaluation Harness).

### Rationale
- Multi-agent frameworks introduce significant non-determinism, API cost, and high latency (often taking 1-2 minutes per response).
- A single high-capability model (Gemini 2.5 Pro) can produce excellent plans if it is given clean structural contexts (subgraphs) and evaluated programmatically.

---

## Decision #3: Static Graph Indexing instead of Real-time Streaming Indexing

### Context
How should we keep the graph updated as the repository changes?

### Decision
We rebuild the graph statically on import and on demand (manual refresh) rather than using file-system watchers.

### Rationale
- Rebuilding the graph statically for an MVP repo of 100-500 files takes under 2 seconds.
- Continuous indexing adds synchronization complexity, race conditions, and heavy memory usage.
