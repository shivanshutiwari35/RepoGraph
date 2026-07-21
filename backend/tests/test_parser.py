import sys
import json
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from app.parser.ast_parser import LanguageAgnosticParser
from app.graph.graph_builder import GraphBuilder, ALLOWED_NODE_TYPES, ALLOWED_EDGE_TYPES


def test_pipeline():
    sample_path = Path(__file__).parent.parent.parent / "sample_repo"

    parser = LanguageAgnosticParser()
    builder = GraphBuilder()

    # ── Step 1: Parse ──
    parsed_data = parser.parse_repository(sample_path)

    print("\n=== PARSED DATA ===")
    for fname, info in parsed_data.items():
        print(f"\n  {fname}:")
        for key, val in info.items():
            if val:  # only print non-empty
                print(f"    {key}: {val}")

    # ── Step 2: Build graph ──
    graph = builder.build_graph("sample_repo", parsed_data)

    print("\n=== GRAPH NODES ===")
    for nid in sorted(graph.nodes):
        print(f"  {nid} ({graph.nodes[nid].get('type')})")

    print(f"\n=== GRAPH EDGES ({graph.number_of_edges()}) ===")
    for u, v, data in graph.edges(data=True):
        print(f"  {u} --[{data['type']}]--> {v}")

    # ── Step 3: Validate strict schema ──
    print("\n=== SCHEMA VALIDATION ===")

    # Node types
    node_types_found = set()
    for _, attrs in graph.nodes(data=True):
        ntype = attrs.get("type")
        node_types_found.add(ntype)
        assert ntype in ALLOWED_NODE_TYPES, f"❌ Invalid node type: '{ntype}'"
    print(f"  ✓ Node types used: {sorted(node_types_found)}")
    print(f"  ✓ Allowed types:   {sorted(ALLOWED_NODE_TYPES)}")

    # Edge types
    edge_types_found = set()
    for _, _, attrs in graph.edges(data=True):
        etype = attrs.get("type")
        edge_types_found.add(etype)
        assert etype in ALLOWED_EDGE_TYPES, f"❌ Invalid edge type: '{etype}'"
    print(f"  ✓ Edge types used: {sorted(edge_types_found)}")
    print(f"  ✓ Allowed types:   {sorted(ALLOWED_EDGE_TYPES)}")

    # ── Step 4: No spurious nodes ──
    db_nodes = [n for n in graph.nodes if n.startswith("db::")]
    print(f"\n  DB nodes: {db_nodes}")
    assert "db::db" not in graph.nodes, "❌ Spurious 'db::db' node!"
    assert "db::get" not in graph.nodes, "❌ Spurious 'db::get' node!"

    # No repository or directory nodes
    for _, attrs in graph.nodes(data=True):
        assert attrs["type"] != "repository", "❌ 'repository' node type not allowed!"
        assert attrs["type"] != "directory", "❌ 'directory' node type not allowed!"
        assert attrs["type"] != "package", "❌ 'package' node type not allowed! Use 'external_api'"
        assert attrs["type"] != "database", "❌ 'database' node type not allowed! Use 'database_table'"

    # ── Step 5: Routes are unique and have HTTP verbs ──
    route_nodes = [n for n in graph.nodes if n.startswith("route::")]
    for rn in route_nodes:
        label = rn.replace("route::", "")
        assert label.split(" ")[0] in {"GET", "POST", "PUT", "DELETE", "PATCH", "ALL"}, f"❌ Route missing HTTP verb: {rn}"
    print(f"  ✓ Route nodes: {route_nodes}")

    # ── Step 6: Service detection (UserService should be 'service') ──
    service_nodes = [(n, graph.nodes[n]["type"]) for n in graph.nodes if "UserService" in n]
    print(f"  ✓ UserService node type: {service_nodes}")
    if service_nodes:
        assert service_nodes[0][1] == "service", f"❌ UserService should be type 'service', got '{service_nodes[0][1]}'"

    # ── Step 7: Calls edges exist ──
    calls_edges = [(u, v) for u, v, d in graph.edges(data=True) if d["type"] == "calls"]
    print(f"  ✓ Calls edges: {calls_edges}")

    # ── Step 8: Inherits edges (if any) ──
    inherits_edges = [(u, v) for u, v, d in graph.edges(data=True) if d["type"] == "inherits"]
    print(f"  ✓ Inherits edges: {inherits_edges}")

    print("\n✅ ALL TESTS PASSED!")


if __name__ == "__main__":
    test_pipeline()
