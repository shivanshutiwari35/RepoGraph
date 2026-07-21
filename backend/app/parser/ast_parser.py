"""
Python-first AST parser for Knowledge Graph extraction.

Supports:
  Frameworks : FastAPI, Flask, Django, DRF, Tornado, Sanic, Starlette
  ORMs       : Django ORM, SQLAlchemy, Peewee, MongoEngine, PyMongo, Tortoise
  Caches     : Redis, Memcached
  Queues     : Celery, Kafka, RabbitMQ, SQS, Kombu
  DB drivers : psycopg2, sqlite3, mysql-connector, pymongo

Node types emitted: file, class, function, service, api, database_table, external_api, queue
Edge types emitted: imports, calls, inherits, writes, reads, depends_on, publishes, subscribes_to
"""
import os
import re
import ast
from pathlib import Path
from typing import List, Dict, Set, Optional


# ── Infrastructure keyword lists ──

DB_ENGINES = {
    "redis", "mongodb", "mongo", "prisma", "mongoose",
    "postgresql", "mysql", "sqlite", "dynamodb", "cassandra",
    "elasticsearch", "memcached", "firestore", "supabase",
    "cockroachdb", "mariadb", "neo4j", "couchdb", "influxdb",
    "psycopg2", "pymongo", "pymysql", "aiopg", "asyncpg",
    "sqlalchemy", "peewee", "tortoise", "mongoengine",
}

QUEUE_ENGINES = {
    "kafka", "rabbitmq", "sqs", "pubsub", "nats", "celery",
    "bullmq", "amqp", "zeromq", "kombu", "pika",
}

ALL_INFRA_KEYWORDS = DB_ENGINES | QUEUE_ENGINES

# Base classes that indicate a Django / SQLAlchemy model → database_table
MODEL_BASE_CLASSES = {
    "Model", "models.Model", "db.Model", "Base",
    "DeclarativeBase", "AbstractBaseUser", "AbstractUser",
    "PermissionsMixin", "TimeStampedModel", "UUIDModel",
    "Document",  # MongoEngine
}

# Base classes that indicate a service / view / controller
SERVICE_BASE_CLASSES = {
    # DRF
    "APIView", "GenericAPIView", "ViewSet", "ModelViewSet",
    "ReadOnlyModelViewSet", "GenericViewSet", "ListAPIView",
    "CreateAPIView", "RetrieveAPIView", "UpdateAPIView",
    "DestroyAPIView", "ListCreateAPIView", "RetrieveUpdateAPIView",
    "RetrieveDestroyAPIView", "RetrieveUpdateDestroyAPIView",
    # Django
    "View", "TemplateView", "ListView", "DetailView",
    "CreateView", "UpdateView", "DeleteView", "FormView",
    # Flask
    "Resource", "MethodView",
    # Tornado
    "RequestHandler", "WebSocketHandler",
    # Generic
    "HTTPEndpoint",
}

# Name suffixes that suggest a service
SERVICE_SUFFIXES = {
    "service", "handler", "controller", "manager", "provider",
    "middleware", "gateway", "adapter", "worker", "processor",
    "scheduler", "dispatcher", "consumer", "producer", "client",
    "view", "viewset", "endpoint", "resource",
}

# Route decorators: maps decorator attribute names to HTTP methods
ROUTE_DECORATOR_ATTRS = {
    "get": "GET", "post": "POST", "put": "PUT", "delete": "DELETE",
    "patch": "PATCH", "route": "ALL", "head": "HEAD", "options": "OPTIONS",
    "api_view": None,  # DRF — method comes from `methods` kwarg
}

# ORM read / write action names
ORM_WRITE_ACTIONS = {
    "save", "insert", "insert_one", "insert_many", "update", "update_one",
    "update_many", "delete", "delete_one", "delete_many", "create",
    "bulk_create", "bulk_update", "upsert", "add", "put_item",
    "set", "setex", "setnx", "mset", "hset", "lpush", "rpush", "sadd",
    "execute", "executemany", "commit",  # raw SQL
    "send", "publish", "apply_async", "delay",  # queues
}

ORM_READ_ACTIONS = {
    "find", "find_one", "find_many", "get", "get_or_create",
    "filter", "exclude", "all", "first", "last", "values", "values_list",
    "aggregate", "annotate", "select_related", "prefetch_related",
    "query", "read", "fetch", "fetchone", "fetchall", "fetchmany",
    "select", "scan", "list", "search", "count", "exists",
    "hget", "hgetall", "lrange", "smembers", "get_item",
    "subscribe", "consume", "receive", "recv",
}

# Celery task decorators
CELERY_TASK_DECORATORS = {"task", "shared_task"}


class LanguageAgnosticParser:
    def __init__(self):
        # Regex patterns for NON-Python languages
        self.regex_patterns = {
            "imports": [
                r"import\s+.*?\s+from\s+['\"]([@a-zA-Z0-9_\-\.\/]+)['\"]",
                r"(?:const|let|var)\s+.*?\s*=\s*require\(\s*['\"]([@a-zA-Z0-9_\-\.\/]+)['\"]\s*\)",
                r"import\s+['\"]([a-zA-Z0-9_\-\.\/]+)['\"]",
                r"^\s*import\s+([a-zA-Z0-9_\-\.]+);?",
                r"^\s*use\s+([a-zA-Z0-9_\-\:]+);?",
            ],
            "classes": [
                r"^\s*class\s+([a-zA-Z0-9_]+)(?:\s+extends\s+([a-zA-Z0-9_]+))?",
                r"^\s*interface\s+([a-zA-Z0-9_]+)",
                r"^\s*struct\s+([a-zA-Z0-9_]+)",
            ],
            "functions": [
                r"^\s*function\s+([a-zA-Z0-9_]+)\s*\(",
                r"(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>",
                r"^\s*func\s+(?:\([^)]*\)\s*)?([a-zA-Z0-9_]+)\s*\(",
                r"^\s*(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(",
                r"^\s*(?:public|private|protected|internal|static|\s)+\s+[a-zA-Z0-9_<>]+\s+([a-zA-Z0-9_]+)\s*\([^\)]*\)\s*\{",
            ],
            "routes": [
                r"\b(?:app|router|route)\.(get|post|put|delete|patch|use)\(\s*['\"]([^'\"]+)['\"]",
                r"\b[a-zA-Z0-9_]+\.(GET|POST|PUT|DELETE|PATCH)\(\s*['\"]([^'\"]+)['\"]",
            ],
            "db_action": r"\.(save|find|insert|update|delete|set|get|query|execute|publish|subscribe|push|put|create|upsert|fetch|select|scan)\(",
            "function_calls": r"\b([a-zA-Z0-9_]+)\s*\(",
        }

    # ═══════════════════════════════════════════════
    # PYTHON AST PARSER — authoritative for .py files
    # ═══════════════════════════════════════════════

    def _parse_python(self, content: str) -> dict:
        """Full AST-based parser for Python files."""
        result = {
            "classes": [],
            "functions": [],
            "imports": [],
            "calls": [],
            "routes": [],
            "db_calls": [],
            "base_classes": {},
            "function_calls": {},
            "models": [],       # classes detected as DB models → database_table
            "services": [],     # classes detected as services
            "celery_tasks": [], # functions decorated with @task / @shared_task
        }

        try:
            tree = ast.parse(content)
        except SyntaxError:
            return self._parse_with_regex(content)

        # ── Pass 0: Collect imported names for resolution ──
        imported_names: Dict[str, str] = {}  # local_name -> module_path
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    local = alias.asname or alias.name
                    imported_names[local] = alias.name
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    for alias in node.names:
                        local = alias.asname or alias.name
                        imported_names[local] = f"{node.module}.{alias.name}"

        # ── Pass 1: Collect all defined names ──
        defined_functions: Set[str] = set()
        defined_classes: Set[str] = set()

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                defined_functions.add(node.name)
            elif isinstance(node, ast.ClassDef):
                defined_classes.add(node.name)

        # ── Pass 2: Extract everything ──
        for node in ast.walk(tree):

            # ── Imports ──
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name not in result["imports"]:
                        result["imports"].append(alias.name)

            elif isinstance(node, ast.ImportFrom):
                if node.module and node.module not in result["imports"]:
                    result["imports"].append(node.module)

            # ── Classes: Inheritance, Model detection, Service detection ──
            elif isinstance(node, ast.ClassDef):
                if node.name not in result["classes"]:
                    result["classes"].append(node.name)

                bases = self._extract_base_names(node)
                if bases:
                    result["base_classes"][node.name] = bases

                # Check if this is a DB model
                if self._is_model_class(node, imported_names):
                    result["models"].append(node.name)

                # Check if this is a service/view/controller
                if self._is_service_class(node, imported_names):
                    result["services"].append(node.name)

                # DRF ViewSet / APIView → extract routes from action methods
                if self._is_drf_viewset(node, imported_names):
                    drf_routes = self._extract_drf_actions(node)
                    for r in drf_routes:
                        if r not in result["routes"]:
                            result["routes"].append(r)

            # ── Functions: Routes, Celery tasks, Internal calls ──
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name not in result["functions"]:
                    result["functions"].append(node.name)

                # Route decorators (FastAPI, Flask, Sanic, Starlette)
                routes = self._extract_routes_from_decorators(node)
                for r in routes:
                    if r not in result["routes"]:
                        result["routes"].append(r)

                # Celery task decorators
                if self._is_celery_task(node):
                    result["celery_tasks"].append(node.name)

                # Internal function calls (direct Name calls only)
                calls_in_func = set()
                for child in ast.walk(node):
                    if isinstance(child, ast.Call):
                        callee = child.func
                        if isinstance(callee, ast.Name) and callee.id in defined_functions:
                            if callee.id != node.name:
                                calls_in_func.add(callee.id)
                if calls_in_func:
                    result["function_calls"][node.name] = list(calls_in_func)

            # ── Assignments: Django urlpatterns, Celery app ──
            elif isinstance(node, ast.Assign):
                django_routes = self._extract_django_urlpatterns(node)
                for r in django_routes:
                    if r not in result["routes"]:
                        result["routes"].append(r)

            # ── General Calls + DB/ORM/Queue detection ──
            elif isinstance(node, ast.Call):
                self._process_call_node(node, result, imported_names)

        return result

    # ── Helper: Extract base class names ──
    @staticmethod
    def _extract_base_names(class_node: ast.ClassDef) -> List[str]:
        bases = []
        for base in class_node.bases:
            if isinstance(base, ast.Name):
                bases.append(base.id)
            elif isinstance(base, ast.Attribute):
                # e.g., models.Model → "models.Model"
                chain = []
                cur = base
                while isinstance(cur, ast.Attribute):
                    chain.append(cur.attr)
                    cur = cur.value
                if isinstance(cur, ast.Name):
                    chain.append(cur.id)
                chain.reverse()
                bases.append(".".join(chain))
        return bases

    # ── Helper: Is this class a DB model? ──
    @staticmethod
    def _is_model_class(class_node: ast.ClassDef, imported_names: dict) -> bool:
        for base in class_node.bases:
            base_str = ""
            if isinstance(base, ast.Name):
                base_str = base.id
            elif isinstance(base, ast.Attribute):
                parts = []
                cur = base
                while isinstance(cur, ast.Attribute):
                    parts.append(cur.attr)
                    cur = cur.value
                if isinstance(cur, ast.Name):
                    parts.append(cur.id)
                parts.reverse()
                base_str = ".".join(parts)

            if base_str in MODEL_BASE_CLASSES:
                return True

            # Resolve through imports: e.g., "from django.db import models" → Model
            if isinstance(base, ast.Name) and base.id in imported_names:
                full_path = imported_names[base.id]
                if any(mb in full_path for mb in ["models.Model", "db.Model", "DeclarativeBase", "Document"]):
                    return True

        # Also check class name heuristic — ends with Model/Table/Entity
        lower = class_node.name.lower()
        if lower.endswith(("model", "table", "entity", "schema")):
            return True

        # Check if class body has Meta inner class with db_table (Django)
        for child in class_node.body:
            if isinstance(child, ast.ClassDef) and child.name == "Meta":
                for stmt in child.body:
                    if isinstance(stmt, ast.Assign):
                        for target in stmt.targets:
                            if isinstance(target, ast.Name) and target.id in {"db_table", "table_name", "tablename"}:
                                return True
        return False

    # ── Helper: Is this class a service/view? ──
    @staticmethod
    def _is_service_class(class_node: ast.ClassDef, imported_names: dict) -> bool:
        # Check by base classes
        for base in class_node.bases:
            base_str = ""
            if isinstance(base, ast.Name):
                base_str = base.id
            elif isinstance(base, ast.Attribute):
                base_str = base.attr
            if base_str in SERVICE_BASE_CLASSES:
                return True
            # Resolve imports
            if isinstance(base, ast.Name) and base.id in imported_names:
                full_path = imported_names[base.id]
                for sbc in SERVICE_BASE_CLASSES:
                    if sbc in full_path:
                        return True

        # Check by name suffix
        lower = class_node.name.lower()
        for suffix in SERVICE_SUFFIXES:
            if lower.endswith(suffix):
                return True

        return False

    # ── Helper: Is this a DRF ViewSet? ──
    @staticmethod
    def _is_drf_viewset(class_node: ast.ClassDef, imported_names: dict) -> bool:
        for base in class_node.bases:
            base_str = ""
            if isinstance(base, ast.Name):
                base_str = base.id
            elif isinstance(base, ast.Attribute):
                base_str = base.attr
            if base_str in {"ViewSet", "ModelViewSet", "ReadOnlyModelViewSet", "GenericViewSet", "APIView", "GenericAPIView"}:
                return True
        return False

    # ── Helper: Extract DRF action methods as routes ──
    @staticmethod
    def _extract_drf_actions(class_node: ast.ClassDef) -> List[str]:
        """DRF maps methods like list/create/retrieve/update/destroy to HTTP verbs."""
        drf_method_map = {
            "list": "GET", "create": "POST", "retrieve": "GET",
            "update": "PUT", "partial_update": "PATCH", "destroy": "DELETE",
        }
        routes = []
        for child in ast.walk(class_node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if child.name in drf_method_map:
                    routes.append(f"{drf_method_map[child.name]} /{class_node.name}")
                # Also check @action decorator
                for dec in child.decorator_list:
                    if isinstance(dec, ast.Call):
                        if isinstance(dec.func, ast.Name) and dec.func.id == "action":
                            # Get methods kwarg
                            methods = ["GET"]
                            for kw in dec.keywords:
                                if kw.arg == "methods" and isinstance(kw.value, ast.List):
                                    methods = []
                                    for elt in kw.value.elts:
                                        if isinstance(elt, ast.Constant):
                                            methods.append(str(elt.value).upper())
                            # Get detail kwarg
                            detail = True
                            for kw in dec.keywords:
                                if kw.arg == "detail" and isinstance(kw.value, ast.Constant):
                                    detail = kw.value.value
                            suffix = f"/{child.name}" if detail else ""
                            for m in methods:
                                routes.append(f"{m} /{class_node.name}{suffix}")
        return routes

    # ── Helper: Extract routes from function decorators ──
    @staticmethod
    def _extract_routes_from_decorators(func_node) -> List[str]:
        routes = []
        for decorator in func_node.decorator_list:
            if isinstance(decorator, ast.Call):
                func = decorator.func
                if isinstance(func, ast.Attribute):
                    attr = func.attr.lower()
                    if attr in ROUTE_DECORATOR_ATTRS:
                        method = ROUTE_DECORATOR_ATTRS[attr]
                        # Get path from first positional arg
                        path = ""
                        if decorator.args and isinstance(decorator.args[0], ast.Constant):
                            path = str(decorator.args[0].value)

                        # For @api_view, extract methods from first arg (list)
                        if attr == "api_view" and decorator.args:
                            if isinstance(decorator.args[0], ast.List):
                                for elt in decorator.args[0].elts:
                                    if isinstance(elt, ast.Constant):
                                        routes.append(f"{str(elt.value).upper()} /{func_node.name}")
                                continue

                        if method is None:
                            method = "ALL"

                        if path:
                            route_str = f"{method.upper()} {path}"
                        else:
                            route_str = f"{method.upper()} /{func_node.name}"
                        routes.append(route_str)

                elif isinstance(func, ast.Name):
                    # @api_view(["GET", "POST"])
                    if func.id == "api_view" and decorator.args:
                        if isinstance(decorator.args[0], ast.List):
                            for elt in decorator.args[0].elts:
                                if isinstance(elt, ast.Constant):
                                    routes.append(f"{str(elt.value).upper()} /{func_node.name}")

            # Bare decorator like @require_GET (Django)
            elif isinstance(decorator, ast.Name):
                if decorator.id in {"require_GET", "require_POST", "require_http_methods"}:
                    method = decorator.id.replace("require_", "").upper()
                    if method == "HTTP_METHODS":
                        method = "ALL"
                    routes.append(f"{method} /{func_node.name}")

        return routes

    # ── Helper: Is this a Celery task? ──
    @staticmethod
    def _is_celery_task(func_node) -> bool:
        for dec in func_node.decorator_list:
            if isinstance(dec, ast.Call):
                func = dec.func
                if isinstance(func, ast.Attribute) and func.attr in CELERY_TASK_DECORATORS:
                    return True
                if isinstance(func, ast.Name) and func.id in CELERY_TASK_DECORATORS:
                    return True
            elif isinstance(dec, ast.Attribute) and dec.attr in CELERY_TASK_DECORATORS:
                return True
            elif isinstance(dec, ast.Name) and dec.id in CELERY_TASK_DECORATORS:
                return True
        return False

    # ── Helper: Extract Django urlpatterns ──
    @staticmethod
    def _extract_django_urlpatterns(assign_node: ast.Assign) -> List[str]:
        """Parse `urlpatterns = [path('api/', view, name='...'), ...]`"""
        routes = []
        for target in assign_node.targets:
            if isinstance(target, ast.Name) and target.id == "urlpatterns":
                if isinstance(assign_node.value, (ast.List, ast.BinOp)):
                    elements = []
                    if isinstance(assign_node.value, ast.List):
                        elements = assign_node.value.elts
                    elif isinstance(assign_node.value, ast.BinOp):
                        # urlpatterns = [...] + [...]
                        if isinstance(assign_node.value.left, ast.List):
                            elements.extend(assign_node.value.left.elts)
                        if isinstance(assign_node.value.right, ast.List):
                            elements.extend(assign_node.value.right.elts)

                    for elt in elements:
                        if isinstance(elt, ast.Call):
                            func_name = ""
                            if isinstance(elt.func, ast.Name):
                                func_name = elt.func.id
                            elif isinstance(elt.func, ast.Attribute):
                                func_name = elt.func.attr

                            if func_name in {"path", "re_path", "url"}:
                                if elt.args and isinstance(elt.args[0], ast.Constant):
                                    url_path = str(elt.args[0].value)
                                    if not url_path.startswith("/"):
                                        url_path = "/" + url_path
                                    routes.append(f"ALL {url_path}")
        return routes

    # ── Helper: Process a Call node for DB/ORM/Queue detection ──
    def _process_call_node(self, node: ast.Call, result: dict, imported_names: dict):
        func = node.func

        if isinstance(func, ast.Name):
            if func.id not in result["calls"]:
                result["calls"].append(func.id)

        elif isinstance(func, ast.Attribute):
            action = func.attr
            if action not in result["calls"]:
                result["calls"].append(action)

            chain = self._resolve_attr_chain(func)

            # 1. Check for direct infra keyword in chain
            infra_hit = self._detect_infra_in_chain(chain)
            if infra_hit:
                val = f"{infra_hit}.{action}"
                if val not in result["db_calls"]:
                    result["db_calls"].append(val)
                return

            # 2. Check for ORM patterns:
            #    Model.objects.filter(...)  → chain = ["Model", "objects", "filter"]
            #    session.query(...)         → chain = ["session", "query"]
            #    cursor.execute(...)        → chain = ["cursor", "execute"]

            # Django ORM: X.objects.Y()
            if len(chain) >= 3 and chain[-2] == "objects":
                model_name = chain[0]
                orm_action = chain[-1]
                db_label = f"orm_{model_name.lower()}"
                val = f"{db_label}.{orm_action}"
                if val not in result["db_calls"]:
                    result["db_calls"].append(val)
                return

            # SQLAlchemy: session.query(), session.add(), session.commit()
            if len(chain) >= 2 and chain[0] in {"session", "db_session", "db"} and action in (ORM_WRITE_ACTIONS | ORM_READ_ACTIONS):
                val = f"sqlalchemy.{action}"
                if val not in result["db_calls"]:
                    result["db_calls"].append(val)
                return

            # Raw DB cursor: cursor.execute(), cursor.fetchall()
            if len(chain) >= 2 and "cursor" in chain[0].lower() and action in {"execute", "executemany", "fetchone", "fetchall", "fetchmany"}:
                val = f"sql.{action}"
                if val not in result["db_calls"]:
                    result["db_calls"].append(val)
                return

            # Celery: task.delay(), task.apply_async()
            if action in {"delay", "apply_async", "send_task"}:
                val = f"celery.{action}"
                if val not in result["db_calls"]:
                    result["db_calls"].append(val)
                return

    @staticmethod
    def _resolve_attr_chain(node) -> list:
        """Walk an ast.Attribute chain and return list of name parts."""
        parts = []
        current = node
        while isinstance(current, ast.Attribute):
            parts.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            parts.append(current.id)
        parts.reverse()
        return parts

    @staticmethod
    def _detect_infra_in_chain(chain: list) -> str:
        """Return the first infrastructure keyword found in a call chain."""
        for part in chain:
            lower = part.lower()
            for kw in ALL_INFRA_KEYWORDS:
                if kw in lower:
                    return kw
        return ""

    # ═══════════════════════════════════════════════
    # NON-PYTHON REGEX PARSER (unchanged)
    # ═══════════════════════════════════════════════

    def _parse_with_regex(self, content: str) -> dict:
        """Regex-based parser for JS/TS/Go/Rust/Java/Kotlin files."""
        result = {
            "classes": [],
            "functions": [],
            "imports": [],
            "calls": [],
            "routes": [],
            "db_calls": [],
            "base_classes": {},
            "function_calls": {},
            "models": [],
            "services": [],
            "celery_tasks": [],
        }

        defined_functions = set()
        lines = content.splitlines()

        for line in lines:
            clean = re.sub(r"//.*|#.*|/\*.*?\*/", "", line).strip()
            for pattern in self.regex_patterns["functions"]:
                m = re.search(pattern, clean)
                if m:
                    defined_functions.add(m.group(1))

        for line in lines:
            clean = re.sub(r"//.*|#.*|/\*.*?\*/", "", line).strip()
            if not clean:
                continue

            for pattern in self.regex_patterns["imports"]:
                m = re.search(pattern, clean)
                if m and m.group(1) not in result["imports"]:
                    result["imports"].append(m.group(1))

            cls_match = re.search(self.regex_patterns["classes"][0], clean)
            if cls_match:
                cls_name = cls_match.group(1)
                if cls_name not in result["classes"]:
                    result["classes"].append(cls_name)
                if cls_match.group(2):
                    result["base_classes"][cls_name] = [cls_match.group(2)]
            else:
                for pattern in self.regex_patterns["classes"][1:]:
                    m = re.search(pattern, clean)
                    if m and m.group(1) not in result["classes"]:
                        result["classes"].append(m.group(1))

            for pattern in self.regex_patterns["functions"]:
                m = re.search(pattern, clean)
                if m and m.group(1) not in result["functions"]:
                    result["functions"].append(m.group(1))

            for pattern in self.regex_patterns["routes"]:
                m = re.search(pattern, clean)
                if m:
                    if len(m.groups()) >= 2:
                        method = m.group(1).upper()
                        path = m.group(2)
                        if method in {"ROUTE", "USE"}:
                            method = "ALL"
                        val = f"{method} {path}"
                    else:
                        val = m.group(1)
                    if val not in result["routes"]:
                        result["routes"].append(val)

            if not clean.startswith(("import ", "from ", "const ", "let ", "var ")):
                lower_line = clean.lower()
                infra_hit = None
                for kw in ALL_INFRA_KEYWORDS:
                    if kw in lower_line:
                        infra_hit = kw
                        break
                if infra_hit:
                    action_match = re.search(self.regex_patterns["db_action"], clean)
                    action = action_match.group(1) if action_match else "use"
                    val = f"{infra_hit}.{action}"
                    if val not in result["db_calls"]:
                        result["db_calls"].append(val)

        return result

    # ═══════════════════════════════════════════════
    # PUBLIC API
    # ═══════════════════════════════════════════════

    def parse_file(self, file_path: Path) -> dict:
        """Parse a single file. Dispatches to AST or regex."""
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            return {}

        suffix = file_path.suffix.lower()
        if suffix == ".py":
            return self._parse_python(content)
        else:
            return self._parse_with_regex(content)

    def parse_repository(self, repo_path: Path) -> dict:
        """Parses all code files and returns rel_path → metadata."""
        repo_data = {}
        skip_dirs = {
            ".git", "node_modules", "venv", "__pycache__", "build", "dist",
            "target", ".next", ".turbo", "env", ".venv", ".tox", ".mypy_cache",
            ".pytest_cache", "eggs", ".eggs", "htmlcov", "migrations",
        }
        code_extensions = {
            ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs",
            ".java", ".kt", ".rb", ".php", ".cs",
        }

        for root, dirs, files in os.walk(repo_path):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for file in files:
                file_path = Path(root) / file
                if file_path.suffix.lower() not in code_extensions:
                    continue
                rel_path = file_path.relative_to(repo_path).as_posix()
                file_info = self.parse_file(file_path)
                if file_info:
                    file_info["size_bytes"] = file_path.stat().st_size
                    file_info["extension"] = file_path.suffix.lower()
                    repo_data[rel_path] = file_info

        return repo_data
