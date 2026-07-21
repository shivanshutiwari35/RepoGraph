import os
import json
import time
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Optional, Any

from app.parser.repo_cloner import RepoCloner
from app.parser.ast_parser import LanguageAgnosticParser
from app.graph.graph_builder import GraphBuilder
from app.planner.router import DecisionRouter
from app.planner.engine import GeminiPlannerEngine
from app.evaluator.harness import EvaluationHarness

app = FastAPI(title="RepoScope API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances
cloner = RepoCloner()
parser = LanguageAgnosticParser()
graph_builder = GraphBuilder()
router = DecisionRouter()
planner_engine = GeminiPlannerEngine()
evaluator = EvaluationHarness()

# Base directories
DATA_DIR = Path(__file__).parent.parent / "data"
GRAPHS_DIR = DATA_DIR / "graphs"
SUMMARIES_DIR = DATA_DIR / "summaries"
METADATA_DIR = DATA_DIR / "metadata"
REPORTS_DIR = DATA_DIR.parent / "reports"
REPOS_INDEX_PATH = DATA_DIR / "repos.json"

for folder in [GRAPHS_DIR, SUMMARIES_DIR, METADATA_DIR, REPORTS_DIR]:
    folder.mkdir(parents=True, exist_ok=True)

class ImportRequest(BaseModel):
    github_url: str

class RouteRequest(BaseModel):
    query: str
    repo_name: str

class PlanRequest(BaseModel):
    query: str
    repo_name: str
    clarifications: Dict[str, str]

@app.get("/")
async def root():
    return {
        "status": "success",
        "message": "RepoScope API Server running",
        "endpoints": {
            "import": "/api/import",
            "graph": "/api/graph",
            "route": "/api/route",
            "plan": "/api/plan",
            "repos": "/api/repos",
            "reports": "/api/reports",
        }
    }

@app.get("/api/reports")
async def list_reports():
    """List all saved plan reports."""
    reports = []
    if REPORTS_DIR.exists():
        for f in sorted(REPORTS_DIR.glob("plan_*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
            with open(f, "r", encoding="utf-8") as fh:
                first_line = fh.readline().strip().lstrip("# ").strip()
            reports.append({
                "filename": f.name,
                "title": first_line or f.stem,
                "size_bytes": f.stat().st_size,
                "created_at": int(f.stat().st_mtime),
            })
    return {"reports": reports}

@app.get("/api/reports/{filename}")
async def get_report(filename: str):
    """Return the full markdown content of a specific report."""
    report_path = REPORTS_DIR / filename
    if not report_path.exists() or not report_path.suffix == ".md":
        raise HTTPException(status_code=404, detail=f"Report not found: {filename}")
    with open(report_path, "r", encoding="utf-8") as f:
        content = f.read()
    return {"filename": filename, "content": content}

@app.post("/api/import")
async def import_repository(req: ImportRequest):
    try:
        # 1. Clone or locate the repository
        path = cloner.clone_or_locate(req.github_url)
        repo_name = path.name
        
        # 2. Detect languages
        lang_info = cloner.detect_languages(path)
        
        # 3. Parse files
        parsed_data = parser.parse_repository(path)
        
        # 4. Build graph
        graph = graph_builder.build_graph(repo_name, parsed_data)
        
        # Save graph data
        graph_path = GRAPHS_DIR / f"{repo_name}_graph.json"
        graph_builder.save_graph(graph_path)
        
        # 5. Extract statistics
        stats = {
            "nodes_count": graph.number_of_nodes(),
            "edges_count": graph.number_of_edges(),
            "languages": lang_info["main_languages"],
            "total_files": lang_info["total_files"]
        }
        
        # Save metadata
        metadata_path = METADATA_DIR / f"{repo_name}_metadata.json"
        with open(metadata_path, "w") as f:
            json.dump({"repo_name": repo_name, "stats": stats, "parsed_data": parsed_data}, f)
            
        # 6. Generate summary using LLM
        summary = await planner_engine.generate_repo_summary(repo_name, parsed_data, stats)
        summary_path = SUMMARIES_DIR / f"{repo_name}_summary.txt"
        with open(summary_path, "w", encoding="utf-8") as f:
            f.write(summary)
            
        # 7. Update repos list index
        repos = {}
        if REPOS_INDEX_PATH.exists():
            try:
                with open(REPOS_INDEX_PATH, "r") as f:
                    repos = json.load(f)
            except Exception:
                pass
        
        repos[repo_name] = {
            "repo_name": repo_name,
            "github_url": req.github_url,
            "stats": stats,
            "summary": summary,
            "timestamp": time.time()
        }
        with open(REPOS_INDEX_PATH, "w") as f:
            json.dump(repos, f, indent=2)
            
        return {
            "status": "success",
            "repo_name": repo_name,
            "stats": stats,
            "summary": summary
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/repos")
async def get_repositories():
    if not REPOS_INDEX_PATH.exists():
        return []
    try:
        with open(REPOS_INDEX_PATH, "r") as f:
            repos = json.load(f)
        return sorted(repos.values(), key=lambda x: x.get("timestamp", 0), reverse=True)
    except Exception:
        return []

@app.get("/api/graph")
async def get_graph(repo_name: Optional[str] = None):
    # If not specified, get the latest imported
    if not repo_name:
        repos = await get_repositories()
        if not repos:
            raise HTTPException(status_code=404, detail="No repositories imported yet.")
        repo_name = repos[0]["repo_name"]

    graph_path = GRAPHS_DIR / f"{repo_name}_graph.json"
    if not graph_path.exists():
        raise HTTPException(status_code=404, detail=f"No graph found for repo: {repo_name}")
    
    with open(graph_path, "r") as f:
        graph_data = json.load(f)
    return graph_data

@app.post("/api/route")
async def route_query(req: RouteRequest):
    summary_path = SUMMARIES_DIR / f"{req.repo_name}_summary.txt"
    if not summary_path.exists():
        raise HTTPException(status_code=404, detail=f"Summary not found for repo: {req.repo_name}")
        
    with open(summary_path, "r") as f:
        summary = f.read()
        
    graph_path = GRAPHS_DIR / f"{req.repo_name}_graph.json"
    if not graph_path.exists():
         raise HTTPException(status_code=404, detail=f"Graph not found for repo: {req.repo_name}")
         
    with open(graph_path, "r") as f:
        graph_data = json.load(f)
        
    stats_str = f"Nodes: {len(graph_data['nodes'])}, Edges: {len(graph_data['edges'])}"
    routing_result = await router.route_query(req.query, f"{stats_str}\n{summary}")
    return routing_result

@app.post("/api/plan")
async def generate_plan(req: PlanRequest):
    graph_path = GRAPHS_DIR / f"{req.repo_name}_graph.json"
    summary_path = SUMMARIES_DIR / f"{req.repo_name}_summary.txt"
    
    if not graph_path.exists() or not summary_path.exists():
         raise HTTPException(status_code=404, detail=f"Repository {req.repo_name} not fully indexed.")
         
    # Load state
    graph = graph_builder.load_graph(graph_path)
    with open(summary_path, "r") as f:
        summary = f.read()
        
    # Build subgraph context
    subgraph_context = {
        "nodes": [],
        "edges": []
    }
    
    target_nodes = []
    for node, attrs in graph.nodes(data=True):
        label = attrs.get("label", "")
        node_type = attrs.get("type", "")
        if label.lower() in req.query.lower() or node_type in {"database", "queue", "package"}:
            target_nodes.append(node)
            
    relevant_nodes = set(target_nodes)
    for target in target_nodes:
        relevant_nodes.update(graph.successors(target))
        relevant_nodes.update(graph.predecessors(target))
        
    for node in relevant_nodes:
        subgraph_context["nodes"].append({
            "id": node,
            "type": graph.nodes[node].get("type"),
            "label": graph.nodes[node].get("label")
        })
        
    for u, v in graph.edges():
        if u in relevant_nodes and v in relevant_nodes:
            subgraph_context["edges"].append({
                "source": u,
                "target": v,
                "type": graph.edges[u, v].get("type")
            })

    async def plan_generator():
        print(f"[API] Starting plan generation stream for query: {req.query}")
        
        full_plan = []
        
        async for chunk_json in planner_engine.generate_plan_sections_stream(
            req.query,
            summary,
            req.clarifications,
            subgraph_context
        ):
            # Parse the chunk to keep track of the full markdown for evaluation
            try:
                data = json.loads(chunk_json)
                if data.get("content"):
                    full_plan.append(data["content"])
            except:
                pass
                
            yield f"data: {chunk_json}\n\n"
            
        # After all sections are generated, evaluate and save
        plan_markdown = "\n\n".join(full_plan)
        if not plan_markdown.strip():
            plan_markdown = "# Plan Generation Failed\nThe model returned no text."
            
        print(f"[API] Plan generated successfully. Length: {len(plan_markdown)}")
        
        print("[API] Running evaluation harness...")
        evaluation = evaluator.evaluate_plan(plan_markdown, graph, req.query)
        print(f"[API] Evaluation completed. Score: {evaluation.get('score', 0)}")
        
        report_path = REPORTS_DIR / f"plan_{req.repo_name}_{int(time.time())}.md"
        print(f"[API] Saving plan report to {report_path}")
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(plan_markdown)
            
        yield f"data: {json.dumps({'status': 'Complete', 'evaluation': evaluation})}\n\n"

    return StreamingResponse(plan_generator(), media_type="text/event-stream")
