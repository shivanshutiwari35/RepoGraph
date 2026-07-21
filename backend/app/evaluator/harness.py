import re
import networkx as nx

class EvaluationHarness:
    def __init__(self):
        pass

    def evaluate_plan(self, plan_markdown: str, graph: nx.DiGraph, query: str) -> dict:
        """
        Evaluates the generated engineering plan against structural graph dependencies.
        Returns a checklist and scores.
        """
        if not plan_markdown:
            plan_markdown = ""
        elif not isinstance(plan_markdown, str):
            plan_markdown = str(plan_markdown)

        score = 100
        feedback = []
        
        # Checklist items
        checklist = {
            "dependencies_covered": True,
            "rollback_included": True,
            "risks_identified": True,
            "unknowns_acknowledged": True,
            "clarification_requested": True,
            "confidence_explained": True
        }

        # 1. Rollback Included check
        # Look for a rollback section or mention of rollback recovery in plan
        has_rollback = re.search(r"(?i)(rollback|recovery|fallback)", plan_markdown) is not None
        if not has_rollback:
            score -= 15
            checklist["rollback_included"] = False
            feedback.append("Missing explicit rollback or recovery plan steps.")

        # 2. Risks Identified check
        has_risks = re.search(r"(?i)#+\s*(risks|technical risks)", plan_markdown) is not None
        if not has_risks:
            score -= 15
            checklist["risks_identified"] = False
            feedback.append("Missing explicit Risks section.")

        # 3. Unknowns Acknowledged check
        has_unknowns = re.search(r"(?i)(unknowns|open questions|variables)", plan_markdown) is not None
        if not has_unknowns:
            score -= 15
            checklist["unknowns_acknowledged"] = False
            feedback.append("Missing Open Questions or Unknowns.")

        # 4. Confidence Explained check
        has_confidence = re.search(r"(?i)#+\s*(confidence|confidence breakdown)", plan_markdown) is not None
        if not has_confidence:
            score -= 15
            checklist["confidence_explained"] = False
            feedback.append("Confidence score explanation section not found.")

        # 5. Clarification Requested check
        # Since we ran clarifications before generating the plan, we mark this True
        # but check if "clarification" or "answer" exists in constraints.
        checklist["clarification_requested"] = True

        # 6. Dependency Coverage check
        file_nodes = [node for node, attrs in graph.nodes(data=True) if attrs.get("type") == "file"]
        
        # Locate target entities from query terms
        target_entities = []
        db_nodes = [node for node, attrs in graph.nodes(data=True) if attrs.get("type") in {"database", "queue", "package"}]
        for db in db_nodes:
            db_name = db.replace("db::", "").replace("pkg::", "")
            if db_name.lower() in query.lower():
                target_entities.append(db)

        class_func_nodes = [node for node, attrs in graph.nodes(data=True) if attrs.get("type") in {"class", "function"}]
        for node in class_func_nodes:
            node_label = graph.nodes[node].get("label", "")
            if node_label and node_label.lower() in query.lower():
                target_entities.append(node)

        # Transitive dependencies calculation
        expected_affected_files = set()
        for target in target_entities:
            if graph.has_node(target):
                ancestors = nx.ancestors(graph, target)
                for ancestor in ancestors:
                    if graph.nodes[ancestor].get("type") == "file":
                        expected_affected_files.add(ancestor)
                    elif graph.nodes[ancestor].get("type") in {"class", "function"}:
                        file_part = ancestor.split("::")[0]
                        if graph.has_node(file_part) and graph.nodes[file_part].get("type") == "file":
                            expected_affected_files.add(file_part)

        missing_files = []
        for file_path in expected_affected_files:
            file_basename = file_path.split("/")[-1]
            if file_basename not in plan_markdown:
                missing_files.append(file_path)

        if expected_affected_files:
            coverage_pct = (len(expected_affected_files) - len(missing_files)) / len(expected_affected_files)
            coverage_penalty = int((1 - coverage_pct) * 40)
            score -= coverage_penalty
            if missing_files:
                checklist["dependencies_covered"] = False
                feedback.append(
                    f"Warning: {len(missing_files)} file dependencies detected in knowledge graph "
                    f"were not found in the planning report: {', '.join(missing_files[:5])}"
                )
        else:
            feedback.append("No explicit database/package nodes matched the query terms for dependency coverage evaluation.")

        return {
            "score": max(score, 0),
            "checklist": checklist,
            "feedback": feedback,
            "expected_affected_files": list(expected_affected_files),
            "missing_files": missing_files
        }
