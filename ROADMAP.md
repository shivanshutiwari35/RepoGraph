# Product Roadmap — RepoScope

## Version 1.0 (MVP) — Static Knowledge & Planning (Current Focus)
- **Deterministic Parsing**: Parse Python repositories to build dependencies.
- **NetworkX graph**: Build and export the repository graph structure.
- **Decision Router**: Detect query intent and handle clarification flows.
- **Gemini Planner**: Generate structured engineering reports.
- **Evaluation Harness**: Programmatically grade plan feasibility.
- **Frontend Dashboard**: Interactive UI with Next.js and React Flow to view graphs and submit planning queries.

---

## Version 2.0 — Dynamic Contexts & Git Integrations
- **Git History Integration**: Include git commit history and author metadata to determine component ownership and stability.
- **PR Planning**: Analyze incoming pull requests and flag downstream architectural breaks before merging.
- **Incremental Indexing**: Support file-level diff updates without rebuilding the whole graph.
- **Multi-language support**: Add full parser support for TypeScript, Go, and Java.

---

## Version 3.0 — Enterprise Toolchains
- **Jira Integration**: Convert phases from the generated plan directly into Jira tickets/epics.
- **Slack App**: Interface RepoScope directly from Slack channels (e.g. `/plan Split UserService`).
- **Confluence Sync**: Publish approved architecture and migration plans to Confluence.
