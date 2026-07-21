import os
import json
from pathlib import Path
import networkx as nx

# ── Strict Schema ──
# Node types: file, class, function, service, api, database_table, external_api, queue
# Edge types: imports, calls, inherits, writes, reads, depends_on, publishes, subscribes_to

ALLOWED_NODE_TYPES = {"file", "class", "function", "service", "api", "database_table", "external_api", "queue"}
ALLOWED_EDGE_TYPES = {"imports", "calls", "inherits", "writes", "reads", "depends_on", "publishes", "subscribes_to"}

# Heuristics for "service" detection
SERVICE_SUFFIXES = {"service", "handler", "controller", "manager", "provider", "middleware", "gateway", "adapter", "worker", "processor", "scheduler", "dispatcher"}

# Queue engine keywords
QUEUE_KEYWORDS = {"kafka", "rabbitmq", "sqs", "pubsub", "nats", "celery", "bullmq", "amqp", "zeromq"}

# Write vs Read action classification
WRITE_ACTIONS = {"save", "insert", "update", "set", "write", "publish", "push", "put", "create", "upsert", "add"}
READ_ACTIONS = {"find", "get", "query", "read", "subscribe", "fetch", "select", "scan", "list", "search", "count"}


class GraphBuilder:
    def __init__(self):
        self.graph = nx.DiGraph()

    def _is_service_name(self, name: str) -> bool:
        """Check if a class/file name looks like a service."""
        lower = name.lower().replace("_", "")
        for suffix in SERVICE_SUFFIXES:
            if lower.endswith(suffix):
                return True
        return False

    def build_graph(self, repo_name: str, parsed_data: dict) -> nx.DiGraph:
        """
        Builds a NetworkX DiGraph using ONLY the allowed node and edge types.
        """
        self.graph.clear()

        # Collect all defined class and function names for cross-file resolution
        all_classes = {}   # class_name -> file_rel_path
        all_functions = {} # func_name -> file_rel_path

        for rel_path, file_info in parsed_data.items():
            for cls in file_info.get("classes", []):
                all_classes[cls] = rel_path
            for func in file_info.get("functions", []):
                all_functions[func] = rel_path

        # ── Build nodes and edges per file ──
        for rel_path, file_info in parsed_data.items():

            # 1. FILE node
            self.graph.add_node(
                rel_path,
                type="file",
                label=os.path.basename(rel_path),
                size_bytes=file_info.get("size_bytes", 0),
                extension=file_info.get("extension", ""),
            )

            # 2. CLASS nodes (classified as service, database_table, or generic class)
            models = set(file_info.get("models", []))
            services = set(file_info.get("services", []))
            for class_name in file_info.get("classes", []):
                class_node_id = f"{rel_path}::{class_name}"
                if class_name in models:
                    node_type = "database_table"
                elif class_name in services or self._is_service_name(class_name):
                    node_type = "service"
                else:
                    node_type = "class"
                self.graph.add_node(class_node_id, type=node_type, label=class_name)
                self.graph.add_edge(rel_path, class_node_id, type="depends_on")

            # 3. FUNCTION nodes (classified as service if they are Celery tasks, else generic function)
            celery_tasks = set(file_info.get("celery_tasks", []))
            for func_name in file_info.get("functions", []):
                func_node_id = f"{rel_path}::{func_name}"
                node_type = "service" if func_name in celery_tasks else "function"
                self.graph.add_node(func_node_id, type=node_type, label=func_name)
                self.graph.add_edge(rel_path, func_node_id, type="depends_on")

            # 4. API nodes (routes)
            for route in file_info.get("routes", []):
                route_node_id = f"route::{route}"
                self.graph.add_node(route_node_id, type="api", label=route)
                self.graph.add_edge(rel_path, route_node_id, type="depends_on")

            # 5. DATABASE_TABLE / QUEUE nodes
            for db_call in file_info.get("db_calls", []):
                db_type = db_call.split(".")[0].lower()
                action = db_call.split(".")[1] if "." in db_call else "use"

                db_node_id = f"db::{db_type}"
                is_queue = db_type in QUEUE_KEYWORDS
                node_type = "queue" if is_queue else "database_table"

                if not self.graph.has_node(db_node_id):
                    self.graph.add_node(db_node_id, type=node_type, label=db_type)

                # Determine edge type
                edge_type = "depends_on"
                if action in WRITE_ACTIONS:
                    edge_type = "writes" if not is_queue else "publishes"
                elif action in READ_ACTIONS:
                    edge_type = "reads" if not is_queue else "subscribes_to"

                self.graph.add_edge(rel_path, db_node_id, type=edge_type)

            # 6. INHERITS edges (class → base class)
            for cls_name, bases in file_info.get("base_classes", {}).items():
                child_node_id = f"{rel_path}::{cls_name}"
                for base_name in bases:
                    # Try to resolve base class to a node in the graph
                    if base_name in all_classes:
                        base_file = all_classes[base_name]
                        base_node_id = f"{base_file}::{base_name}"
                    else:
                        # External base class — create as external_api
                        base_node_id = f"ext::{base_name}"
                        if not self.graph.has_node(base_node_id):
                            self.graph.add_node(base_node_id, type="external_api", label=base_name)
                    self.graph.add_edge(child_node_id, base_node_id, type="inherits")

            # 7. CALLS edges (function → function)
            for caller_name, callees in file_info.get("function_calls", {}).items():
                caller_node_id = f"{rel_path}::{caller_name}"
                for callee_name in callees:
                    # Resolve callee: same file first, then cross-file
                    if callee_name in file_info.get("functions", []):
                        callee_node_id = f"{rel_path}::{callee_name}"
                    elif callee_name in all_functions:
                        callee_file = all_functions[callee_name]
                        callee_node_id = f"{callee_file}::{callee_name}"
                    else:
                        continue  # can't resolve
                    self.graph.add_edge(caller_node_id, callee_node_id, type="calls")

        # 8. IMPORTS edges (file → file) and EXTERNAL_API nodes
        file_paths = set(parsed_data.keys())
        for rel_path, file_info in parsed_data.items():
            for imp in file_info.get("imports", []):
                resolved = self._resolve_import(rel_path, imp, file_paths)
                if resolved:
                    self.graph.add_edge(rel_path, resolved, type="imports")
                else:
                    pkg_node_id = f"pkg::{imp}"
                    if not self.graph.has_node(pkg_node_id):
                        self.graph.add_node(pkg_node_id, type="external_api", label=imp)
                    self.graph.add_edge(rel_path, pkg_node_id, type="depends_on")

        # ── Validation: assert all nodes/edges match schema ──
        for _, attrs in self.graph.nodes(data=True):
            assert attrs.get("type") in ALLOWED_NODE_TYPES, f"Invalid node type: {attrs.get('type')}"
        for _, _, attrs in self.graph.edges(data=True):
            assert attrs.get("type") in ALLOWED_EDGE_TYPES, f"Invalid edge type: {attrs.get('type')}"

        return self.graph

    def _resolve_import(self, current_file: str, import_name: str, internal_files: set) -> str:
        """Attempts to resolve an import path to a relative file path."""
        clean_imp = import_name.replace(".", "/")
        candidates = [
            clean_imp + ".py",
            clean_imp + ".ts",
            clean_imp + ".js",
            clean_imp + "/index.ts",
            clean_imp + "/index.js",
        ]

        for cand in candidates:
            if cand in internal_files:
                return cand

        curr_dir = os.path.dirname(current_file)
        if curr_dir:
            for cand in candidates:
                rel_cand = os.path.join(curr_dir, cand)
                if rel_cand in internal_files:
                    return rel_cand

        for file in internal_files:
            if file.endswith(clean_imp + ".py") or file.endswith(clean_imp + ".ts"):
                return file

        return ""

    def to_json(self) -> str:
        """Serializes graph to Node-Link JSON."""
        nodes = []
        for node_id, attrs in self.graph.nodes(data=True):
            nodes.append({
                "id": node_id,
                "type": attrs.get("type", "file"),
                "label": attrs.get("label", node_id),
                "properties": {k: v for k, v in attrs.items() if k not in {"type", "label"}}
            })

        edges = []
        for source, target, attrs in self.graph.edges(data=True):
            edges.append({
                "source": source,
                "target": target,
                "type": attrs.get("type", "depends_on")
            })

        return json.dumps({"nodes": nodes, "edges": edges}, indent=2)

    def save_graph(self, file_path: Path):
        """Saves the graph JSON to disk."""
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(self.to_json())

    def load_graph(self, file_path: Path) -> nx.DiGraph:
        """Loads graph from JSON."""
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.graph.clear()
        for node in data.get("nodes", []):
            self.graph.add_node(
                node["id"],
                type=node["type"],
                label=node["label"],
                **node.get("properties", {})
            )
        for edge in data.get("edges", []):
            self.graph.add_edge(edge["source"], edge["target"], type=edge["type"])

        return self.graph
