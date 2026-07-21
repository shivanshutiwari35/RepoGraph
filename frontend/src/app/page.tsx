"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { 
  GitBranch, 
  Terminal, 
  Settings, 
  HelpCircle, 
  Layers, 
  Compass, 
  Cpu, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Play, 
  RefreshCw,
  Info,
  Database,
  Grid,
  Search,
  ArrowRightLeft
} from "lucide-react";

const DependencyGraph = dynamic(
  () => import("@/components/DependencyGraph"),
  { ssr: false }
);

interface GraphNode {
  id: string;
  type: string;
  label: string;
  properties?: Record<string, any>;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

interface ClarificationQuestion {
  id: string;
  question: string;
  options: string[];
}

interface RoutingResult {
  need_graph?: boolean;
  need_retrieval?: boolean;
  need_planning?: boolean;
  need_multiple_agents?: boolean;
  need_clarification?: boolean;
  need_code_generation?: boolean;
  clarification_questions?: ClarificationQuestion[];
  reasoning?: string;
  error?: string;
}

interface EvaluationResult {
  score: number;
  checklist: {
    dependencies_covered: boolean;
    rollback_included: boolean;
    risks_identified: boolean;
    unknowns_acknowledged: boolean;
    clarification_requested: boolean;
    confidence_explained: boolean;
  };
  feedback: string[];
  expected_affected_files: string[];
  missing_files: string[];
}

interface RepositoryItem {
  repo_name: string;
  github_url: string;
  stats: any;
  summary: string;
  timestamp: number;
}

interface ReportItem {
  filename: string;
  title: string;
  size_bytes: number;
  created_at: number;
}

export default function RepoScopeDashboard() {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [currentView, setCurrentView] = useState<"landing" | "app">("landing");
  
  // Repository state
  const [repoUrl, setRepoUrl] = useState<string>("");
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [repoName, setRepoName] = useState<string>("");
  const [repoSummary, setRepoSummary] = useState<string>("");
  const [repoStats, setRepoStats] = useState<any>(null);
  
  // Dynamic history list
  const [recentRepos, setRecentRepos] = useState<RepositoryItem[]>([]);

  // Graph state
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Planning state
  const [planningQuery, setPlanningQuery] = useState<string>("");
  const [isRouting, setIsRouting] = useState<boolean>(false);
  const [routingResult, setRoutingResult] = useState<RoutingResult | null>(null);
  const [routerLogs, setRouterLogs] = useState<string>("");
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  
  // Pipeline status checks
  const [pipelineStep, setPipelineStep] = useState<"idle" | "routing" | "clarifying" | "planning" | "completed">("idle");
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);
  const [pipelineStatusText, setPipelineStatusText] = useState<string>("");  
  const [planMarkdown, setPlanMarkdown] = useState<string>("");
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  const [activePlanDetailTab, setActivePlanDetailTab] = useState<string>("execution");

  // Reports state
  const [savedReports, setSavedReports] = useState<ReportItem[]>([]);
  const [selectedReportContent, setSelectedReportContent] = useState<string>("");
  const [selectedReportFilename, setSelectedReportFilename] = useState<string>("");
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Notifications
  const [notification, setNotification] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);

  // Dependency Explorer State
  const [explorerRoot, setExplorerRoot] = useState<string>("");
  const [exploreDirection, setExploreDirection] = useState<"downstream" | "upstream">("downstream");

  const showNotification = (type: "success" | "error" | "info", msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 5000);
  };

  // Load repositories on mount
  useEffect(() => {
    fetchRecentRepos();
  }, [currentView]);

  const fetchRecentRepos = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/repos");
      if (res.ok) {
        const data = await res.json();
        setRecentRepos(data || []);
      }
    } catch (err) {
      console.error("Failed to load repo index from backend:", err);
    }
  };

  // Fetch saved reports
  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:8000/api/reports");
      if (res.ok) {
        const data = await res.json();
        setSavedReports(data.reports || []);
      }
    } catch (err) {
      console.error("Failed to load reports:", err);
    }
  }, []);

  useEffect(() => {
    if (currentView === "app") {
      fetchReports();
    }
  }, [currentView, fetchReports]);

  // Fetch a specific report's content
  const fetchReportContent = async (filename: string) => {
    if (selectedReportFilename === filename) {
      setSelectedReportFilename("");
      setSelectedReportContent("");
      return;
    }
    try {
      const res = await fetch(`http://localhost:8000/api/reports/${filename}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedReportContent(data.content || "");
        setSelectedReportFilename(filename);
      }
    } catch (err) {
      console.error("Failed to load report content:", err);
    }
  };



  // Load a repository from the dynamic history list
  const handleSelectRepo = async (repo: RepositoryItem) => {
    setRepoName(repo.repo_name);
    setRepoStats(repo.stats);
    setRepoSummary(repo.summary);
    
    // Fetch specifically indexed graph
    try {
      const res = await fetch(`http://localhost:8000/api/graph?repo_name=${repo.repo_name}`);
      if (res.ok) {
        const graphData = await res.json();
        setGraphNodes(graphData.nodes || []);
        setGraphEdges(graphData.edges || []);
      }
      setCurrentView("app");
      setActiveTab("dashboard");
    } catch (err: any) {
      showNotification("error", "Failed to retrieve graph data.");
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setIsImporting(true);
    showNotification("info", "Starting Repository Analysis (deterministic parsing)...");

    try {
      const res = await fetch("http://localhost:8000/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github_url: repoUrl })
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      setRepoName(data.repo_name);
      setRepoStats(data.stats);
      setRepoSummary(data.summary);
      
      // Fetch graph
      const graphRes = await fetch(`http://localhost:8000/api/graph?repo_name=${data.repo_name}`);
      if (graphRes.ok) {
        const graphData = await graphRes.json();
        setGraphNodes(graphData.nodes || []);
        setGraphEdges(graphData.edges || []);
      }

      showNotification("success", `Repository ${data.repo_name} imported successfully!`);
      setCurrentView("app");
      setActiveTab("dashboard");
    } catch (err: any) {
      showNotification("error", `Import failed: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const filteredNodes = useMemo(() => {
    if (!searchQuery) return graphNodes;
    return graphNodes.filter(n => 
      n.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
      n.type.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [graphNodes, searchQuery]);

  const startPlanningPipeline = async () => {
    if (!planningQuery || !repoName) return;
    setPipelineStep("routing");
    setPipelineProgress(20);
    setPipelineStatusText("Calling LLM Decision Router...");
    setRoutingResult(null);
    setPlanMarkdown("");
    setEvaluationResult(null);
    setClarificationAnswers({});
    setRouterLogs("Running Decision Router...\n");

    try {
      const res = await fetch("http://localhost:8000/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: planningQuery, repo_name: repoName })
      });

      if (!res.ok) throw new Error(await res.text());
      const data: RoutingResult = await res.json();
      setRoutingResult(data);

      let logStr = "Decision Router classification complete:\n";
      logStr += `- Need Repository Graph? ${data.need_graph ? "YES" : "NO"}\n`;
      logStr += `- Need Retrieval? ${data.need_retrieval ? "YES" : "NO"}\n`;
      logStr += `- Need Planning? ${data.need_planning ? "YES" : "NO"}\n`;
      logStr += `- Need Multiple Agents? ${data.need_multiple_agents ? "YES" : "NO"}\n`;
      logStr += `- Need Human Clarification? ${data.need_clarification ? "YES" : "NO"}\n`;
      logStr += `- Need Code Generation? ${data.need_code_generation ? "YES" : "NO"}\n\n`;
      logStr += `REASONING:\n${data.reasoning || ""}`;
      setRouterLogs(logStr);

      if (data.need_clarification && data.clarification_questions?.length) {
        setPipelineStep("clarifying");
        setPipelineProgress(40);
        setPipelineStatusText("Awaiting human clarification input...");
        showNotification("info", "Clarification required. Please answer parameters.");
      } else {
        await executePlanningEngine({});
      }
    } catch (err: any) {
      setRouterLogs(prev => prev + `\nError routing query: ${err.message}`);
      setPipelineStep("idle");
      setPipelineStatusText("");
      showNotification("error", `Routing failed: ${err.message}`);
    }
  };

  const executePlanningEngine = async (answers: Record<string, string>) => {
    setPipelineStep("planning");
    setPipelineProgress(70);
    setPlanMarkdown("");
    setPipelineStatusText("Connecting to LLM...");
    showNotification("info", "Planner Engine is drafting detailed architectural report...");

    try {
      const res = await fetch("http://localhost:8000/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query: planningQuery, 
          repo_name: repoName,
          clarifications: answers 
        })
      });
      
      if (!res.ok) throw new Error(await res.text());
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      
      let buffer = "";
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        
        for (const part of parts) {
          if (part.startsWith("data: ")) {
            const dataStr = part.slice(6);
            try {
              const data = JSON.parse(dataStr);
              
              if (data.status) {
                if (data.status === "Complete") {
                  setEvaluationResult(data.evaluation);
                  setPipelineProgress(100);
                  setPipelineStep("completed");
                  setPipelineStatusText("");
                  showNotification("success", "Engineering plan generated and verified!");
                  fetchReports();
                } else {
                  setPipelineStatusText(data.status);
                  setPipelineProgress(prev => Math.min(prev + 5, 95));
                }
              }
              
              if (data.error) {
                 throw new Error(data.error);
              }
              
              if (data.section && data.content) {
                setPlanMarkdown(prev => prev + (prev ? "\n\n" : "") + data.content);
                
                if (data.section === "executive_summary") {
                   setActivePlanDetailTab("execution");
                } else if (data.section === "phases") {
                   setActivePlanDetailTab("execution");
                } else if (data.section === "risks_questions") {
                   setActivePlanDetailTab("risks");
                } else if (data.section === "reasoning") {
                   setActivePlanDetailTab("reasoning");
                }
              }
            } catch (err) {
              console.error("Failed to parse SSE JSON:", err);
            }
          }
        }
      }
    } catch (err: any) {
      setPipelineStep("idle");
      setPipelineProgress(0);
      setPipelineStatusText("");
      showNotification("error", `Planning failed: ${err.message}`);
    }
  };

  const handleAnswerClick = (qId: string, opt: string) => {
    setClarificationAnswers(prev => ({ ...prev, [qId]: opt }));
  };

  const isAllClarified = () => {
    const questions = routingResult?.clarification_questions || [];
    return questions.every(q => clarificationAnswers[q.id]);
  };

  const formatTimeAgo = (timestamp: number) => {
    const diffSeconds = Math.floor((Date.now() / 1000) - timestamp);
    if (diffSeconds < 60) return "Just now";
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  // Helper: extract a top-level markdown section (# Heading) until the next top-level # heading
  const extractSection = useCallback((md: string, headerPattern: RegExp): string => {
    const match = md.match(headerPattern);
    if (!match) return "";
    const startIdx = match.index! + match[0].length;
    // Find the next top-level heading (# but not ## or ###)
    const rest = md.slice(startIdx);
    const nextH1 = rest.search(/\n#\s+[^#]/);
    const sectionText = nextH1 === -1 ? rest : rest.slice(0, nextH1);
    return sectionText.trim();
  }, []);

  // Helper properties extraction from raw plan markdown
  const parsedExecutiveSummary = useMemo(() => {
    if (!planMarkdown) return "";
    return extractSection(planMarkdown, /^#+\s*(?:Executive\s*)?Summary\s*$/mi);
  }, [planMarkdown, extractSection]);

  const parsedFeasibility = useMemo(() => {
    if (!planMarkdown) return "Unknown";
    const match = planMarkdown.match(/-\s*Feasibility:\s*\*?([a-zA-Z\s]+)\*?/i);
    return match ? match[1].trim() : "Feasible";
  }, [planMarkdown]);

  const parsedRisk = useMemo(() => {
    if (!planMarkdown) return "Medium";
    const match = planMarkdown.match(/-\s*Risk:\s*\*?([a-zA-Z\s]+)\*?/i);
    return match ? match[1].trim() : "Medium";
  }, [planMarkdown]);

  const parsedConfidence = useMemo(() => {
    if (!planMarkdown) return "80%";
    const match = planMarkdown.match(/-\s*Confidence:\s*\*?([0-9%]+)\*?/i);
    return match ? match[1].trim() : "80%";
  }, [planMarkdown]);

  const parsedSuggestedPlanPhases = useMemo((): { title: string; body: string }[] => {
    if (!planMarkdown) return [];

    // Extract the full "Suggested Plan" section
    const sectionText = extractSection(planMarkdown, /^#+\s*(?:Suggested\s*)?Plan\s*$/mi);
    if (!sectionText) return [];

    // Split by ### Phase headings and capture each block
    const phaseBlocks: { title: string; body: string }[] = [];
    const phaseRegex = /^###\s*(?:\*\*)?\s*(Phase\s*\d+[^:\-\n*]*)(?:\*\*)?\s*[:\-]?\s*(?:\*\*)?\s*(.*?)(?:\*\*)?\s*$/gmi;
    const matches = [...sectionText.matchAll(phaseRegex)];

    if (matches.length === 0) {
      // Fallback: treat entire section as one block
      return [{ title: "Plan", body: sectionText }];
    }

    for (let i = 0; i < matches.length; i++) {
      const matchItem = matches[i];
      const title = (matchItem[1].trim() + (matchItem[2] ? ": " + matchItem[2].trim() : "")).replace(/\*\*/g, "");
      const startIdx = matchItem.index! + matchItem[0].length;
      const endIdx = i + 1 < matches.length ? matches[i + 1].index! : sectionText.length;
      const body = sectionText.slice(startIdx, endIdx).trim();
      phaseBlocks.push({ title, body });
    }

    return phaseBlocks;
  }, [planMarkdown, extractSection]);

  const parsedRisksList = useMemo(() => {
    if (!planMarkdown) return [];
    const sectionText = extractSection(planMarkdown, /^#+\s*(?:Potential\s*)?Risks?(?:\s*&\s*Mitigations?)?\s*$/mi);
    if (!sectionText) return [];

    // Split into risk entries: each starts with "- **" or "- " at the start of a line
    const entries: string[] = [];
    const lines = sectionText.split("\n");
    let current = "";
    for (const line of lines) {
      if (/^-\s+/.test(line)) {
        if (current) entries.push(current.trim());
        current = line.replace(/^-\s+/, "");
      } else if (current && line.trim()) {
        current += " " + line.trim();
      }
    }
    if (current) entries.push(current.trim());
    return entries;
  }, [planMarkdown, extractSection]);

  const parsedOpenQuestions = useMemo(() => {
    if (!planMarkdown) return [];
    const sectionText = extractSection(planMarkdown, /^#+\s*Open\s*Questions?\s*$/mi);
    if (!sectionText) return [];

    const entries: string[] = [];
    const lines = sectionText.split("\n");
    let current = "";
    for (const line of lines) {
      if (/^\d+\.\s+/.test(line) || /^-\s+/.test(line)) {
        if (current) entries.push(current.trim());
        current = line.replace(/^\d+\.\s+/, "").replace(/^-\s+/, "");
      } else if (current && line.trim()) {
        current += " " + line.trim();
      }
    }
    if (current) entries.push(current.trim());
    return entries;
  }, [planMarkdown, extractSection]);

  const parsedReasoningText = useMemo(() => {
    if (!planMarkdown) return "";
    return extractSection(planMarkdown, /^#+\s*(?:Explain\s*the\s*)?Reasoning\s*$/mi);
  }, [planMarkdown, extractSection]);

  // Reusable Sidebar details renderer for selected graph nodes
  const renderSelectedNodeSidebar = () => {
    if (!selectedNode) return null;

    // Calculate incoming/outgoing edges
    const incomingEdges = graphEdges.filter(e => e.target === selectedNode.id);
    const outgoingEdges = graphEdges.filter(e => e.source === selectedNode.id);
    const totalConnections = incomingEdges.length + outgoingEdges.length;

    // Calculate Risk rating
    let risk = "Low";
    let riskColor = "text-emerald-500 font-bold";
    if (totalConnections > 8) {
      risk = "High";
      riskColor = "text-rose-500 font-bold";
    } else if (totalConnections > 3) {
      risk = "Medium";
      riskColor = "text-amber-500 font-bold";
    }

    // Calculate Used By count
    const usedByCount = incomingEdges.length;

    // Calculate associated files
    let fileCount = 0;
    if (selectedNode.type === "file") {
      fileCount = 1;
    } else {
      const parts = selectedNode.id.split("::");
      if (parts.length > 1 && parts[0].includes(".")) {
        fileCount = 1;
      } else {
        fileCount = incomingEdges.filter(e => {
          const srcNode = graphNodes.find(n => n.id === e.source);
          return srcNode?.type === "file";
        }).length;
      }
    }

    // Calculate associated functions
    let funcCount = 0;
    if (selectedNode.type === "function") {
      funcCount = 1;
    } else if (selectedNode.type === "file") {
      funcCount = graphNodes.filter(n => n.type === "function" && n.id.startsWith(selectedNode.id + "::")).length;
    } else if (selectedNode.type === "class" || selectedNode.type === "service") {
      const classPrefix = selectedNode.id + "::";
      funcCount = graphNodes.filter(n => n.type === "function" && n.id.startsWith(classPrefix)).length;
    }

    // Formatter for node type
    const formattedType = selectedNode.type
      .split("_")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

    // Determine functional capabilities (Provides)
    let providesList: string[] = [];
    if (selectedNode.type === "service" || selectedNode.type === "file") {
      providesList = graphNodes
        .filter(n => n.id.startsWith(selectedNode.id + "::") && n.type === "function")
        .map(n => n.label.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "))
        .slice(0, 3);
    }
    if (providesList.length === 0) {
      providesList = ["Process Handling", "Operation Dispatch"];
    }

    // Determine outgoing dependencies (Depends On)
    const dependsOnNodes = outgoingEdges
      .map(e => graphNodes.find(n => n.id === e.target))
      .filter((n): n is GraphNode => !!n);

    return (
      <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-zinc-900 bg-zinc-950 p-6 space-y-6 overflow-y-auto shrink-0">
        <div>
          <h4 className="text-xs uppercase font-bold tracking-wider text-zinc-500">Node Properties</h4>
          <h3 className="text-sm font-bold text-white mt-1 break-all">{selectedNode.label}</h3>
        </div>
        
        <div className="space-y-4 text-xs border-t border-zinc-900 pt-4">
          {/* Type */}
          <div className="flex justify-between items-center py-0.5">
            <span className="text-zinc-500 font-medium">Type</span>
            <span className="font-semibold text-zinc-350">{formattedType}</span>
          </div>

          {/* Risk */}
          <div className="flex justify-between items-center py-0.5">
            <span className="text-zinc-500 font-medium">Risk</span>
            <span className={riskColor}>{risk}</span>
          </div>

          {/* Provides List */}
          <div className="space-y-1.5 pt-1">
            <span className="text-zinc-500 font-medium block">Provides</span>
            <ul className="list-disc list-inside pl-1 text-[11px] text-zinc-400 space-y-0.5">
              {providesList.map((item, idx) => (
                <li key={idx} className="truncate">{item}</li>
              ))}
            </ul>
          </div>

          {/* Depends On Badge Row */}
          {dependsOnNodes.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-zinc-500 font-medium block">Depends On</span>
              <div className="flex flex-wrap gap-1.5">
                {dependsOnNodes.slice(0, 4).map(node => (
                  <button
                    key={node.id}
                    onClick={() => setSelectedNode(node)}
                    className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-[10px] font-bold text-zinc-455 hover:text-white px-2 py-0.5 rounded transition"
                  >
                    {node.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Files */}
          <div className="flex justify-between items-center py-0.5 border-t border-zinc-900 pt-3">
            <span className="text-zinc-500 font-medium">Files</span>
            <span className="font-semibold text-zinc-350">{fileCount}</span>
          </div>

          {/* Functions */}
          <div className="flex justify-between items-center py-0.5">
            <span className="text-zinc-500 font-medium">Functions</span>
            <span className="font-semibold text-zinc-350">{funcCount}</span>
          </div>
        </div>

        {/* Connections List (Incoming Relations & Dependencies) */}
        <div className="border-t border-zinc-900 pt-4 space-y-4">
          <div className="space-y-2">
            <h5 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 font-mono">incoming relations</h5>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {incomingEdges.length === 0 ? (
                <div className="text-[10px] text-zinc-650 italic">No incoming connections</div>
              ) : (
                incomingEdges.map((e, index) => {
                  const sourceNode = graphNodes.find(n => n.id === e.source);
                  return (
                    <div key={index} className="text-xs bg-zinc-900/50 p-2 rounded border border-zinc-900 flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[9px]">
                        <span className="text-indigo-400 font-mono">:{e.type.toUpperCase()}</span>
                        <span className="text-zinc-500 uppercase">{sourceNode?.type || "unknown"}</span>
                      </div>
                      <div className="text-zinc-350 truncate">{sourceNode?.label || e.source}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h5 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 font-mono">dependencies</h5>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {outgoingEdges.length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic">No outgoing dependencies</div>
              ) : (
                outgoingEdges.map((e, index) => {
                  const targetNode = graphNodes.find(n => n.id === e.target);
                  return (
                    <div key={index} className="text-xs bg-zinc-900/50 p-2 rounded border border-zinc-900 flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[9px]">
                        <span className="text-indigo-400 font-mono">:{e.type.toUpperCase()}</span>
                        <span className="text-zinc-500 uppercase">{targetNode?.type || "unknown"}</span>
                      </div>
                      <div className="text-zinc-350 truncate">{targetNode?.label || e.target}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Clean up and format markdown inline elements (like **bold** and `code`)
  const formatMarkdownText = (text: string) => {
    if (!text) return "";
    
    // Split text by bold markers (**)
    const parts = text.split(/\*\*([\s\S]*?)\*\*/g);
    return parts.map((part, index) => {
      // Every odd index is bold text
      if (index % 2 === 1) {
        return <strong key={index} className="text-white font-bold">{part}</strong>;
      }
      
      // For normal text, split by code block backticks (`)
      const subParts = part.split(/`([^`\n]+)`/g);
      return subParts.map((subPart, subIndex) => {
        if (subIndex % 2 === 1) {
          return (
            <code key={subIndex} className="bg-zinc-900 border border-zinc-850 px-1 py-0.5 rounded font-mono text-indigo-400 text-[10px]">
              {subPart}
            </code>
          );
        }
        return subPart;
      });
    });
  };

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased selection:bg-indigo-600 selection:text-white">
      
      {/* 1. LANDING PAGE VIEW */}
      {currentView === "landing" && (
        <div className="flex flex-col min-h-screen bg-radial-at-t from-zinc-900 via-zinc-950 to-black">
          <header className="flex items-center justify-between px-16 py-6 z-15">
            <div className="flex items-center gap-2">
              <Layers className="h-6 w-6 text-indigo-500" />
              <span className="font-bold text-lg text-white tracking-wider">RepoScope</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-zinc-400">
              <a href="#" className="hover:text-white transition">Docs</a>
              <a href="https://github.com" target="_blank" className="flex items-center gap-1 hover:text-white transition">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" />
                </svg>
                GitHub
              </a>
            </div>
          </header>

          <main className="flex-1 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 px-16 items-center">
            <div className="lg:col-span-6 space-y-8">
              <div className="space-y-4">
                <h1 className="text-5xl font-black tracking-tight text-white leading-tight">
                  Repository<br />Intelligence
                </h1>
                <p className="text-zinc-400 text-sm max-w-md">
                  Understand your codebase dependencies, map data flows, and build architectural plan summaries before committing changes.
                </p>
              </div>

              <form onSubmit={handleImport} className="space-y-3 max-w-md">
                <input
                  type="text"
                  placeholder="https://github.com/username/repository or local folder path"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-600 text-sm transition"
                />
                <button
                  type="submit"
                  disabled={isImporting || !repoUrl}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition shadow-lg shadow-orange-500/20"
                >
                  {isImporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Analyze Repository"}
                </button>
              </form>

              {/* Dynamic Recent Repositories */}
              <div className="space-y-3 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Recent Repositories</h3>
                <div className="space-y-2 max-w-md">
                  {recentRepos.length === 0 ? (
                    <div className="text-xs text-zinc-600 italic">No repositories imported yet. Paste a link above to get started.</div>
                  ) : (
                    recentRepos.map((repo) => (
                      <div 
                        key={repo.repo_name}
                        onClick={() => handleSelectRepo(repo)}
                        className="flex justify-between items-center p-3 rounded-lg bg-zinc-900/50 border border-zinc-850 hover:bg-zinc-900 cursor-pointer transition"
                      >
                        <span className="text-xs font-semibold text-zinc-200">{repo.repo_name}</span>
                        <span className="text-[10px] text-zinc-500">{formatTimeAgo(repo.timestamp)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Stepper */}
              <div className="grid grid-cols-5 gap-2 pt-6 border-t border-zinc-900 text-center max-w-lg">
                {[
                  { step: "1", title: "Analyze", desc: "We parse your repository" },
                  { step: "2", title: "Build Graph", desc: "Extract relationships" },
                  { step: "3", title: "Understand", desc: "AI summarizes logic" },
                  { step: "4", title: "Plan", desc: "Generate change steps" },
                  { step: "5", title: "Evaluate", desc: "Measure plan quality" }
                ].map((item) => (
                  <div key={item.step} className="space-y-1.5">
                    <div className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-indigo-400 flex items-center justify-center mx-auto">
                      {item.step}
                    </div>
                    <div className="text-[10px] font-bold text-zinc-200">{item.title}</div>
                    <div className="text-[8px] text-zinc-500 leading-tight">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-6 hidden lg:flex justify-center items-center relative h-[450px]">
              <div className="absolute inset-0 bg-indigo-500/5 rounded-full blur-3xl" />
              <div className="w-[380px] h-[380px] rounded-full border border-dashed border-zinc-800/60 flex items-center justify-center relative">
                <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold border border-indigo-400 shadow-xl shadow-indigo-600/30">
                  <Layers className="h-6 w-6" />
                </div>
                <div className="absolute top-12 left-16 w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-400 shadow">API</div>
                <div className="absolute bottom-16 right-12 w-9 h-9 rounded-full bg-emerald-950 border border-emerald-700 flex items-center justify-center text-[10px] font-bold text-emerald-400 shadow">DB</div>
                <div className="absolute top-24 right-8 w-10 h-10 rounded-full bg-blue-950 border border-blue-800 flex items-center justify-center text-[10px] font-bold text-blue-400 shadow">SVC</div>
                <div className="absolute bottom-28 left-8 w-8 h-8 rounded-full bg-purple-950 border border-purple-800 flex items-center justify-center text-[10px] font-bold text-purple-400 shadow">MQ</div>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* 2. MAIN APP DASHBOARD VIEW */}
      {currentView === "app" && (
        <div className="flex flex-1 flex-row h-screen overflow-hidden animate-fadeIn">
          
          {/* Sidebar */}
          <aside className="w-64 border-r border-zinc-900 bg-zinc-950 flex flex-col justify-between p-4 z-20">
            <div className="space-y-6">
              <div onClick={() => setCurrentView("landing")} className="flex items-center gap-2 px-2 cursor-pointer">
                <Layers className="h-5 w-5 text-indigo-500" />
                <span className="font-bold text-sm tracking-wider text-white">RepoScope</span>
              </div>

              {/* Switch Repository */}
              <button
                onClick={() => setCurrentView("landing")}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold tracking-wide text-zinc-450 hover:text-white hover:bg-zinc-900/50 border border-dashed border-zinc-800 transition-all"
              >
                <ArrowRightLeft className="h-4 w-4 shrink-0 text-indigo-400" />
                Switch Repository
              </button>

              <nav className="space-y-1">
                {[
                  { id: "dashboard", label: "Dashboard", icon: Compass },
                  { id: "graph", label: "Knowledge Graph", icon: Grid },
                  { id: "explorer", label: "Dependency Explorer", icon: Layers },
                  { id: "planning", label: "Planning", icon: Cpu },
                  { id: "architecture", label: "Architecture", icon: FileText },
                  { id: "reports", label: "Reports", icon: FileText },
                  { id: "evaluation", label: "Evaluation", icon: CheckCircle2 },
                  { id: "settings", label: "Settings", icon: Settings }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                        activeTab === item.id
                          ? "bg-zinc-900 text-indigo-400 border border-zinc-850"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="border-t border-zinc-900 pt-4 flex items-center gap-3 px-2">
              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-300 font-bold text-xs uppercase">
                AS
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-white truncate">Arjun Sharma</div>
                <div className="text-[9px] text-zinc-500 truncate">arjun@example.com</div>
              </div>
            </div>
          </aside>

          {/* Main Workspace */}
          <main className="flex-1 bg-zinc-950 flex flex-col overflow-hidden">
            
            {/* TAB: DASHBOARD */}
            {activeTab === "dashboard" && (() => {
              // 1. Calculate dynamic statistics
              const filesCount = graphNodes.filter(n => n.type === "file").length;
              const classesCount = graphNodes.filter(n => n.type === "class").length;
              const functionsCount = graphNodes.filter(n => n.type === "function").length;
              const apisCount = graphNodes.filter(n => n.type === "api").length;
              const servicesCount = graphNodes.filter(n => n.type === "service").length;
              const dbTablesCount = graphNodes.filter(n => n.type === "database_table").length;
              const queuesCount = graphNodes.filter(n => n.type === "queue").length;
              const totalDeps = graphEdges.length;

              // Calculate critical modules based on degree centrality (incoming + outgoing connections)
              const nodeDegrees: Record<string, number> = {};
              graphNodes.forEach(node => {
                nodeDegrees[node.id] = 0;
              });
              graphEdges.forEach(edge => {
                if (nodeDegrees[edge.source] !== undefined) nodeDegrees[edge.source]++;
                if (nodeDegrees[edge.target] !== undefined) nodeDegrees[edge.target]++;
              });

              // Get top 3 most connected file/class/service modules for the complexity list
              const sortedModules = graphNodes
                .filter(n => ["file", "class", "service"].includes(n.type))
                .map(node => ({
                  name: node.label,
                  connections: nodeDegrees[node.id] || 0
                }))
                .sort((a, b) => b.connections - a.connections)
                .slice(0, 3);

              // Normalize to a 0-100 complexity range
              const maxConnections = sortedModules.length > 0 ? sortedModules[0].connections : 1;
              const topModules = sortedModules.map(m => ({
                name: m.name,
                complexity: Math.max(25, Math.min(95, Math.round((m.connections / maxConnections) * 100)))
              }));

              // If list is empty, default to placeholders
              if (topModules.length === 0) {
                topModules.push(
                  { name: "Main Engine", complexity: 78 },
                  { name: "Auth Handler", complexity: 62 },
                  { name: "DB Connection Manager", complexity: 41 }
                );
              }

              // Compute Repository Health Scores dynamically
              const structureCoverage = filesCount > 0 ? Math.min(100, Math.round(((classesCount + functionsCount + apisCount) / (filesCount * 4)) * 100)) : 80;
              const dependencyPercent = totalDeps > 0 ? Math.min(100, Math.max(50, Math.round((1 - (totalDeps / 500)) * 100))) : 92;
              const securityScore = 80; // Placeholder base score
              const testCoverage = 76;   // Static placeholder base score
              const overallScore = Math.round((structureCoverage + dependencyPercent + securityScore + testCoverage) / 4);
              
              const healthLabel = overallScore >= 80 ? "Good" : overallScore >= 60 ? "Fair" : "Poor";
              const healthColor = overallScore >= 80 ? "text-emerald-500 stroke-emerald-500" : overallScore >= 60 ? "text-amber-500 stroke-amber-500" : "text-rose-500 stroke-rose-500";

              return (
                <div className="flex-1 p-8 overflow-y-auto space-y-6">
                  {/* Dashboard Header Bar */}
                  <div className="flex justify-between items-start border-b border-zinc-900 pb-5">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-2xl font-bold text-white tracking-tight">{repoName || "Select Repository"}</h2>
                        <span className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-400 bg-zinc-900/60 px-2.5 py-1 rounded-md border border-zinc-850">
                          <GitBranch className="h-3.5 w-3.5 text-zinc-500" />
                          main
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-bold bg-indigo-950/40 border border-indigo-900/60 text-indigo-400 px-2.5 py-0.5 rounded-full">
                          Python
                        </span>
                        <span className="text-[10px] font-bold bg-sky-950/40 border border-sky-900/60 text-sky-400 px-2.5 py-0.5 rounded-full">
                          FastAPI
                        </span>
                        {dbTablesCount > 0 && (
                          <span className="text-[10px] font-bold bg-rose-950/40 border border-rose-900/60 text-rose-400 px-2.5 py-0.5 rounded-full">
                            Database
                          </span>
                        )}
                        {queuesCount > 0 && (
                          <span className="text-[10px] font-bold bg-purple-950/40 border border-purple-900/60 text-purple-400 px-2.5 py-0.5 rounded-full">
                            Queue
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-[10px] text-zinc-500 font-medium">
                        Last analyzed: just now
                      </div>
                      <button 
                        onClick={() => handleImport({ preventDefault: () => {} } as any)}
                        className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-350 hover:text-white font-bold text-xs rounded-lg transition"
                      >
                        Re-analyze
                      </button>
                    </div>
                  </div>

                  {/* Architecture & Health Block */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Architecture Summary Card */}
                    <div className="lg:col-span-8 bg-zinc-900/25 border border-zinc-900 p-6 rounded-xl flex flex-col justify-between space-y-4">
                      <div className="space-y-2.5">
                        <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 font-mono">Architecture Summary</h3>
                        <p className="text-xs text-zinc-350 leading-relaxed font-medium whitespace-pre-wrap">
                          {repoSummary ? formatMarkdownText(repoSummary) : "No repository analyzed yet. Go back to the landing page and import a Python workspace."}
                        </p>
                      </div>

                      {/* Stat pills at bottom of architecture summary */}
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-900/50">
                        {servicesCount > 0 && (
                          <span className="text-[10px] font-bold bg-zinc-900 text-zinc-300 border border-zinc-800 px-3 py-1 rounded-md">
                            {servicesCount} {servicesCount === 1 ? "Service" : "Services"}
                          </span>
                        )}
                        {apisCount > 0 && (
                          <span className="text-[10px] font-bold bg-zinc-900 text-zinc-300 border border-zinc-800 px-3 py-1 rounded-md">
                            {apisCount} APIs
                          </span>
                        )}
                        {dbTablesCount > 0 && (
                          <span className="text-[10px] font-bold bg-zinc-900 text-zinc-300 border border-zinc-800 px-3 py-1 rounded-md">
                            {dbTablesCount} {dbTablesCount === 1 ? "Database Table" : "Database Tables"}
                          </span>
                        )}
                        {queuesCount > 0 && (
                          <span className="text-[10px] font-bold bg-zinc-900 text-zinc-300 border border-zinc-800 px-3 py-1 rounded-md">
                            {queuesCount} Queue
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Repository Health Card */}
                    <div className="lg:col-span-4 bg-zinc-900/25 border border-zinc-900 p-6 rounded-xl flex flex-col items-center justify-between space-y-5">
                      <div className="w-full text-left">
                        <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 font-mono">Repository Health</h3>
                      </div>
                      
                      {/* Interactive Circular Progress Bar */}
                      <div className="flex items-center gap-6 justify-center w-full">
                        <div className="relative w-24 h-24">
                          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <path
                              className="text-zinc-800"
                              strokeWidth="2.5"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                            <path
                              className={healthColor}
                              strokeDasharray={`${overallScore}, 100`}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-2xl font-black text-white">{overallScore}</span>
                            <span className={`text-[8px] font-bold uppercase tracking-wider ${healthColor}`}>{healthLabel}</span>
                          </div>
                        </div>

                        {/* Health metrics list */}
                        <div className="flex-1 space-y-2.5">
                          {[
                            { label: "Tests", val: testCoverage },
                            { label: "Documentation", val: structureCoverage },
                            { label: "Security", val: securityScore },
                            { label: "Dependencies", val: dependencyPercent }
                          ].map(metric => (
                            <div key={metric.label} className="flex justify-between items-center text-[10px] border-b border-zinc-900 pb-1 last:border-0 last:pb-0">
                              <span className="text-zinc-400 font-medium">{metric.label}</span>
                              <span className="text-zinc-200 font-bold">{metric.val}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Repository Stats Grid */}
                  <div className="space-y-2.5">
                    <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 font-mono">Repository Stats</h3>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                      {[
                        { label: "Files", val: filesCount },
                        { label: "Classes", val: classesCount },
                        { label: "Functions", val: functionsCount },
                        { label: "APIs", val: apisCount },
                        { label: "Dependencies", val: totalDeps },
                        { label: "Critical Modules", val: sortedModules.length }
                      ].map(stat => (
                        <div key={stat.label} className="bg-zinc-900/15 border border-zinc-900/80 p-4 rounded-xl space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                            <span className="text-[9px] uppercase font-bold tracking-wider text-zinc-500">{stat.label}</span>
                          </div>
                          <div className="text-2xl font-black text-white tracking-tight">{stat.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bottom section: Complexity & Tech stack grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top Modules by Complexity */}
                    <div className="bg-zinc-900/20 border border-zinc-900 p-6 rounded-xl space-y-4">
                      <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 font-mono">Top Modules by Complexity</h3>
                      <div className="space-y-4">
                        {topModules.map(mod => (
                          <div key={mod.name} className="space-y-1.5">
                            <div className="flex justify-between items-center text-[10px] font-semibold">
                              <span className="text-zinc-300 font-mono">{mod.name}</span>
                              <span className="text-zinc-400">{mod.complexity}</span>
                            </div>
                            <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-amber-500 to-rose-500 h-full rounded-full transition-all duration-500"
                                style={{ width: `${mod.complexity}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Technology Stack */}
                    <div className="bg-zinc-900/20 border border-zinc-900 p-6 rounded-xl space-y-4">
                      <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 font-mono">Technology Stack</h3>
                      <div className="grid grid-cols-3 gap-2.5 text-[10px] font-bold text-zinc-300">
                        {["Python", "FastAPI", "MongoDB", "Redis", "Kafka", "Docker", "Pytest", "SQLAlchemy"].map(tech => (
                          <div key={tech} className="bg-zinc-900/80 border border-zinc-850 p-2.5 rounded-lg text-center flex items-center justify-center font-mono">
                            {tech}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* TAB: KNOWLEDGE GRAPH */}
            {activeTab === "graph" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-zinc-900 flex flex-wrap gap-4 items-center bg-zinc-950">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-550" />
                    <input
                      type="text"
                      placeholder="Search nodes (e.g. UserService)"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-900 border border-zinc-850 text-xs text-zinc-200 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex-1 flex flex-col lg:flex-row relative">
                  <div className="flex-1 h-full relative">
                    <DependencyGraph 
                      nodesData={filteredNodes} 
                      edgesData={graphEdges} 
                      onNodeSelect={setSelectedNode}
                    />
                  </div>
                  
                  {/* Selected Node Details */}
                  {renderSelectedNodeSidebar()}
                </div>
              </div>
            )}

            {/* TAB: DEPENDENCY EXPLORER */}
            {activeTab === "explorer" && (() => {
              // Calculate trace subgraph on execution (without nested hooks)
              let traceNodes: any[] = [];
              if (explorerRoot) {
                const visited = new Set();
                const queue = [explorerRoot];
                visited.add(explorerRoot);

                while (queue.length > 0) {
                  const current = queue.shift();
                  if (exploreDirection === "downstream") {
                    const dependencies = graphEdges
                      .filter(e => e.source === current)
                      .map(e => e.target);
                    for (const dep of dependencies) {
                      if (!visited.has(dep)) {
                        visited.add(dep);
                        queue.push(dep);
                      }
                    }
                  } else {
                    const dependents = graphEdges
                      .filter(e => e.target === current)
                      .map(e => e.source);
                    for (const dep of dependents) {
                      if (!visited.has(dep)) {
                        visited.add(dep);
                        queue.push(dep);
                      }
                    }
                  }
                }
                traceNodes = graphNodes.filter(n => visited.has(n.id));
              }

              const nodeIds = new Set(traceNodes.map(n => n.id));
              const traceEdges = graphEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

              return (
                <div className="flex-1 p-8 overflow-y-auto space-y-6 flex flex-col h-full bg-zinc-950">
                  <div className="flex justify-between items-center border-b border-zinc-900 pb-4">
                    <div>
                      <h2 className="text-xl font-bold text-white">Dependency Explorer</h2>
                      <p className="text-xs text-zinc-500">Trace and isolate hierarchical dependency paths for specific components.</p>
                    </div>

                    {/* Selector Controls */}
                    <div className="flex items-center gap-3">
                      <select 
                        value={explorerRoot} 
                        onChange={(e) => setExplorerRoot(e.target.value)}
                        className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 rounded-lg px-3 py-1.5 focus:outline-none"
                      >
                        <option value="">-- Choose Module to Trace --</option>
                        {graphNodes
                          .filter(n => ["service", "file", "class", "api"].includes(n.type))
                          .sort((a, b) => a.label.localeCompare(b.label))
                          .map(n => (
                            <option key={n.id} value={n.id}>
                              {n.label} ({n.type.toUpperCase()})
                            </option>
                          ))}
                      </select>

                      <select 
                        value={exploreDirection} 
                        onChange={(e) => setExploreDirection(e.target.value as any)}
                        className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 rounded-lg px-3 py-1.5 focus:outline-none"
                      >
                        <option value="downstream">Trace Outgoing (Dependencies)</option>
                        <option value="upstream">Trace Incoming (Used By)</option>
                      </select>
                    </div>
                  </div>

                  {/* Render Visual Path */}
                  {explorerRoot ? (
                    <div className="flex-1 flex flex-col lg:flex-row relative gap-6 min-h-[480px]">
                      <div className="flex-1 relative border border-zinc-900 rounded-xl overflow-hidden bg-zinc-950/40">
                        <div className="absolute top-4 left-4 z-10 bg-zinc-950/80 border border-zinc-900 p-3 rounded-lg backdrop-blur-md">
                          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Active Trace</div>
                          <div className="text-xs text-indigo-400 font-mono mt-1">
                            Showing {traceNodes.length} connected modules ({exploreDirection})
                          </div>
                        </div>
                        
                        <DependencyGraph 
                          nodesData={traceNodes} 
                          edgesData={traceEdges}
                          onNodeSelect={setSelectedNode}
                        />
                      </div>
                      
                      {/* Selected Node Details */}
                      {renderSelectedNodeSidebar()}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-zinc-850 rounded-xl min-h-[400px] p-6 text-center space-y-4">
                      <Layers className="h-12 w-12 text-zinc-700 animate-pulse" />
                      <div className="space-y-1.5 max-w-sm">
                        <h3 className="text-sm font-bold text-zinc-300">No Module Selected</h3>
                        <p className="text-xs text-zinc-500">
                          Select a class, service, or API from the selector dropdown to isolate and explore its specific dependency chain.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 justify-center max-w-md pt-2">
                        {graphNodes
                          .filter(n => n.type === "service" || (n.type === "file" && n.label.endsWith(".py")))
                          .slice(0, 4)
                          .map(n => (
                            <button
                              key={n.id}
                              onClick={() => setExplorerRoot(n.id)}
                              className="text-[10px] font-semibold bg-zinc-900/60 hover:bg-zinc-850 border border-zinc-800 text-zinc-400 hover:text-white px-3 py-1 rounded-md transition"
                            >
                              Trace {n.label}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* TAB: PLANNING */}
            {activeTab === "planning" && (
              <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-zinc-950">
                <div className="w-full lg:w-96 border-r border-zinc-900 p-6 space-y-6 overflow-y-auto">
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">What change are you planning?</h3>
                    <textarea
                      rows={5}
                      placeholder="e.g. Migrate MongoDB to PostgreSQL."
                      value={planningQuery}
                      onChange={(e) => setPlanningQuery(e.target.value)}
                      className="w-full p-3 bg-zinc-900 border border-zinc-850 rounded-lg text-xs text-zinc-200 placeholder-zinc-650 focus:outline-none focus:border-indigo-600 resize-none"
                    />
                    <button
                      onClick={startPlanningPipeline}
                      className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition"
                    >
                      Analyze Plan
                    </button>
                  </div>
                </div>

                <div className="flex-1 p-8 overflow-y-auto space-y-8">
                  {pipelineStep !== "idle" && (
                    <div className="space-y-6 max-w-4xl">
                      
                      {/* Pipeline Stage visualizer */}
                      <div className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-xl grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                        <div className="md:col-span-6 space-y-3">
                          <h4 className="text-xs uppercase font-bold text-zinc-400">Planning Pipeline</h4>
                          
                          <div className="space-y-2 text-xs">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              <span className="text-zinc-300">Repository Context</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              <span className="text-zinc-300">Dependency Analysis</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className={`h-4 w-4 ${pipelineProgress >= 50 ? "text-emerald-500" : "text-zinc-600 animate-pulse"}`} />
                              <span className="text-zinc-300">Decision Routing</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {pipelineProgress >= 70 ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              ) : (
                                <div className={`h-4 w-4 rounded-full border-2 ${pipelineStep === "planning" ? "border-indigo-500 animate-pulse" : "border-zinc-700"}`} />
                              )}
                              <span className="text-zinc-350">Planning</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {pipelineProgress === 100 ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              ) : (
                                <div className="h-4 w-4 rounded-full border-2 border-zinc-800" />
                              )}
                              <span className="text-zinc-400">Evaluation</span>
                            </div>
                          </div>
                        </div>

                        {/* Circular Progress Gauge - Closing at 100% */}
                        <div className="md:col-span-6 flex flex-col items-center">
                          <div className="relative w-24 h-24">
                            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                              <path
                                className="text-zinc-850"
                                strokeWidth="3"
                                stroke="currentColor"
                                fill="none"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              />
                              <path
                                className={`stroke-indigo-500 ${pipelineStep === "planning" ? "transition-all duration-1000" : ""}`}
                                strokeDasharray={`${pipelineProgress}, 100`}
                                strokeWidth="3"
                                strokeLinecap="round"
                                fill="none"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-xl font-black text-white">{pipelineProgress}%</span>
                            </div>
                          </div>
                          <div className="mt-3 text-center">
                            {pipelineStep === "routing" && (
                              <span className="text-[10px] text-indigo-400 font-semibold animate-pulse">{pipelineStatusText || "Analyzing query..."}</span>
                            )}
                            {pipelineStep === "clarifying" && (
                              <span className="text-[10px] text-orange-400 font-semibold">{pipelineStatusText || "Awaiting your input"}</span>
                            )}
                            {pipelineStep === "planning" && (
                              <span className="text-[10px] text-indigo-400 font-semibold animate-pulse">{pipelineStatusText || "Connecting to LLM..."}</span>
                            )}
                            {pipelineStep === "completed" && (
                              <span className="text-[10px] text-emerald-400 font-semibold">Complete</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Decision Router */}
                      {routingResult && (
                        <div className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-xl space-y-6">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Decision Router Checks</h4>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-2">
                              {[
                                { k: "Need repository graph?", v: routingResult.need_graph },
                                { k: "Need planning?", v: routingResult.need_planning },
                                { k: "Need retrieval?", v: routingResult.need_retrieval },
                                { k: "Need code generation?", v: routingResult.need_code_generation },
                                { k: "Need multiple agents?", v: routingResult.need_multiple_agents },
                                { k: "Need human clarification?", v: routingResult.need_clarification }
                              ].map(item => (
                                <div key={item.k} className="flex justify-between items-center text-xs border-b border-zinc-900 pb-1.5 last:border-0">
                                  <span className="text-zinc-400">{item.k}</span>
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.v ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}`}>
                                    {item.v ? "YES" : "NO"}
                                  </span>
                                </div>
                              ))}
                            </div>

                            <div className="space-y-4">
                              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-900 text-xs text-zinc-400 leading-relaxed">
                                <strong className="text-zinc-300 block mb-1">Reasoning Strategy:</strong>
                                {routingResult.reasoning}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Clarification prompt */}
                      {pipelineStep === "clarifying" && routingResult?.clarification_questions && (
                        <div className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-xl space-y-4 border-l-4 border-l-orange-500">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-orange-550">Clarification Panel</h4>
                          <div className="space-y-4">
                            {routingResult.clarification_questions.map(q => (
                              <div key={q.id} className="flex justify-between items-center text-xs border-b border-zinc-900 pb-3 last:border-0">
                                <span className="text-zinc-300">{q.question}</span>
                                <div className="flex gap-2">
                                  {q.options.map(opt => (
                                    <button
                                      key={opt}
                                      onClick={() => handleAnswerClick(q.id, opt)}
                                      className={`px-3 py-1 rounded-full text-[10px] font-bold transition ${
                                        clarificationAnswers[q.id] === opt
                                          ? "bg-orange-600 text-white"
                                          : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                          
                          <button
                            onClick={() => executePlanningEngine(clarificationAnswers)}
                            disabled={!isAllClarified()}
                            className="w-full py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-zinc-850 disabled:text-zinc-650 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition"
                          >
                            Submit Clarifications & Generate Plan
                          </button>
                        </div>
                      )}

                      {/* Phased implementation report card */}
                      {pipelineStep === "completed" && planMarkdown && (
                        <div className="space-y-6">
                          
                          <div className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-xl grid grid-cols-1 md:grid-cols-12 gap-8">
                            <div className="md:col-span-8 space-y-4">
                              <h4 className="text-xs uppercase font-bold text-zinc-400">Executive Summary</h4>
                              <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                                {formatMarkdownText(parsedExecutiveSummary) || "Feasible. Summary parsed."}
                              </p>
                              
                              <div className="grid grid-cols-3 gap-4 text-center">
                                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900">
                                  <div className="text-xs text-zinc-500 font-bold uppercase">Feasibility</div>
                                  <div className="text-sm font-bold text-emerald-450 mt-1">{parsedFeasibility}</div>
                                </div>
                                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900">
                                  <div className="text-xs text-zinc-500 font-bold uppercase">Risk Level</div>
                                  <div className="text-sm font-bold text-amber-450 mt-1">{parsedRisk}</div>
                                </div>
                                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900">
                                  <div className="text-xs text-zinc-500 font-bold uppercase">Planner Confidence</div>
                                  <div className="text-sm font-bold text-indigo-400 mt-1">{parsedConfidence}</div>
                                </div>
                              </div>
                            </div>

                            <div className="md:col-span-4 bg-zinc-950 p-4 rounded-xl border border-zinc-900 space-y-2">
                              <h5 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Plan Check stats</h5>
                              <div className="space-y-1 text-xs text-zinc-400">
                                <div>• Expected affected files: {evaluationResult?.expected_affected_files?.length || 0}</div>
                                <div>• Untracked references: {evaluationResult?.missing_files?.length || 0}</div>
                              </div>
                            </div>
                          </div>

                          {/* Phases Details Tabs */}
                          <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl overflow-hidden">
                            <div className="flex border-b border-zinc-900 bg-zinc-950 px-4">
                              {[["execution", "Execution"], ["risks", "Risks"], ["questions", "Open Questions"], ["reasoning", "Reasoning"]].map(([tab, label]) => (
                                <button
                                  key={tab}
                                  onClick={() => setActivePlanDetailTab(tab)}
                                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition ${
                                    activePlanDetailTab === tab
                                      ? "border-indigo-500 text-white"
                                      : "border-transparent text-zinc-550 hover:text-zinc-300"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>

                            <div className="p-6">
                              {activePlanDetailTab === "execution" && (
                                <div className="space-y-5">
                                  {parsedSuggestedPlanPhases.length === 0 ? (
                                    <div className="text-xs text-zinc-450">No phases found in the plan output.</div>
                                  ) : (
                                    parsedSuggestedPlanPhases.map((phase, idx) => (
                                      <div key={idx} className="border border-zinc-900 rounded-lg overflow-hidden">
                                        <div className="flex items-center gap-3 bg-zinc-950 px-4 py-3 border-b border-zinc-900">
                                          <div className="px-2 py-0.5 bg-indigo-950 border border-indigo-800 rounded text-[9px] font-bold text-indigo-400 shrink-0">Phase {idx + 1}</div>
                                          <span className="text-xs font-semibold text-zinc-200">{formatMarkdownText(phase.title)}</span>
                                        </div>
                                        <div className="px-4 py-3 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">
                                          {formatMarkdownText(phase.body)}
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}

                              {activePlanDetailTab === "risks" && (
                                <div className="space-y-3">
                                  {parsedRisksList.length === 0 ? (
                                    <div className="text-xs text-zinc-450">No specific risks found in the plan output.</div>
                                  ) : (
                                    parsedRisksList.map((risk, i) => (
                                      <div key={i} className="flex items-start gap-3 border-b border-zinc-900 pb-3 last:border-0">
                                        <div className="px-1.5 py-0.5 bg-rose-950 border border-rose-900 rounded text-[9px] font-bold text-rose-400 shrink-0 mt-0.5">R{i + 1}</div>
                                        <span className="text-xs text-zinc-300 leading-relaxed">{formatMarkdownText(risk)}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}

                              {activePlanDetailTab === "questions" && (
                                <div className="space-y-3">
                                  {parsedOpenQuestions.length === 0 ? (
                                    <div className="text-xs text-zinc-450">No open questions found in the plan output.</div>
                                  ) : (
                                    parsedOpenQuestions.map((q, i) => (
                                      <div key={i} className="flex items-start gap-3 border-b border-zinc-900 pb-3 last:border-0">
                                        <div className="px-1.5 py-0.5 bg-amber-950 border border-amber-900 rounded text-[9px] font-bold text-amber-400 shrink-0 mt-0.5">Q{i + 1}</div>
                                        <span className="text-xs text-zinc-300 leading-relaxed">{formatMarkdownText(q)}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}

                              {activePlanDetailTab === "reasoning" && (
                                <div className="text-xs text-zinc-350 leading-relaxed whitespace-pre-wrap">
                                  {parsedReasoningText ? formatMarkdownText(parsedReasoningText) : "No reasoning section found in the plan output."}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Plan score card evaluator */}
                          {evaluationResult && (
                            <div className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-xl grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                              <div className="md:col-span-8 space-y-4">
                                <h4 className="text-xs uppercase font-bold text-zinc-400">Plan Quality Evaluation</h4>
                                
                                <div className="space-y-2">
                                  {[
                                    { label: "Dependency Coverage", v: evaluationResult.checklist.dependencies_covered, detail: evaluationResult.checklist.dependencies_covered ? "Pass" : "Warning" },
                                    { label: "Risk Analysis", v: evaluationResult.checklist.risks_identified, detail: evaluationResult.checklist.risks_identified ? "Pass" : "Fail" },
                                    { label: "Rollback Plan", v: evaluationResult.checklist.rollback_included, detail: evaluationResult.checklist.rollback_included ? "Pass" : "Fail" },
                                    { label: "Open Questions", v: evaluationResult.checklist.unknowns_acknowledged, detail: evaluationResult.checklist.unknowns_acknowledged ? "Pass" : "Fail" },
                                    { label: "Confidence Explanation", v: evaluationResult.checklist.confidence_explained, detail: evaluationResult.checklist.confidence_explained ? "Pass" : "Fail" }
                                  ].map(chk => (
                                    <div key={chk.label} className="flex justify-between items-center text-xs border-b border-zinc-900 pb-1.5 last:border-0">
                                      <span className="text-zinc-400">{chk.label}</span>
                                      <span className={`font-bold ${chk.v ? "text-emerald-450" : "text-rose-450"}`}>{chk.detail}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="md:col-span-4 flex flex-col items-center justify-center space-y-4">
                                <div className="w-28 h-28 rounded-full border-4 border-indigo-500 flex flex-col items-center justify-center bg-zinc-950 border-t-transparent shadow-xl">
                                  <span className="text-3xl font-black text-white">{evaluationResult.score}</span>
                                  <span className="text-[9px] text-zinc-500 font-bold uppercase">/100</span>
                                </div>
                              </div>
                            </div>
                          )}

                        </div>
                      )}

                    </div>
                  )}

                  {pipelineStep === "idle" && (
                    <div className="h-[400px] border border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center text-center text-zinc-500">
                      <Cpu className="h-8 w-8 text-zinc-700 mb-3" />
                      <p className="text-xs max-w-sm leading-relaxed">
                        Input your refactoring query in the left panel and click **Analyze Plan** to see live Decision Router checks and scored architecture reports.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: ARCHITECTURE */}
            {activeTab === "architecture" && (
              <div className="flex-1 p-8 overflow-y-auto space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Architecture Summary</h2>
                  <p className="text-xs text-zinc-500">Overview of project dependencies, modules, and database engines.</p>
                </div>
                <div className="prose prose-invert text-xs leading-relaxed bg-zinc-900/30 border border-zinc-900 p-8 rounded-xl max-w-4xl whitespace-pre-wrap text-zinc-300">
                  {formatMarkdownText(repoSummary)}
                </div>
              </div>
            )}

            {/* TAB: REPORTS */}
            {activeTab === "reports" && (
              <div className="flex-1 p-8 overflow-y-auto space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-white">Reports</h2>
                    <p className="text-xs text-zinc-500">History of generated architectural plans for changes.</p>
                  </div>
                  <button
                    onClick={fetchReports}
                    className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-semibold text-zinc-400 hover:text-white hover:border-zinc-700 transition"
                  >
                    Refresh
                  </button>
                </div>
                {savedReports.length === 0 ? (
                  <div className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-xl max-w-4xl text-center text-zinc-500 text-xs py-12">
                    No exported reports found. Generate a plan first.
                  </div>
                ) : (
                  <div className="space-y-3 max-w-4xl">
                    {savedReports.map((report) => (
                      <div key={report.filename} className="bg-zinc-900/30 border border-zinc-900 rounded-xl overflow-hidden">
                        <button
                          onClick={() => fetchReportContent(report.filename)}
                          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-zinc-900/50 transition"
                        >
                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-zinc-200">{report.title}</div>
                            <div className="text-[10px] text-zinc-500">{report.filename} · {(report.size_bytes / 1024).toFixed(1)} KB</div>
                          </div>
                          <div className="text-[10px] text-zinc-500">{formatTimeAgo(report.created_at)}</div>
                        </button>
                        {selectedReportFilename === report.filename && selectedReportContent && (
                          <div className="border-t border-zinc-900 px-5 py-4 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-[500px] overflow-y-auto">
                            {formatMarkdownText(selectedReportContent)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB: EVALUATION */}
            {activeTab === "evaluation" && (
              <div className="flex-1 p-8 overflow-y-auto space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Evaluation</h2>
                  <p className="text-xs text-zinc-500">Programmatic validation runs for code compatibility checks.</p>
                </div>
                {!evaluationResult ? (
                  <div className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-xl max-w-4xl text-center text-zinc-500 text-xs py-12">
                    No evaluation benchmarks executed yet. Generate a plan first.
                  </div>
                ) : (
                  <div className="max-w-4xl space-y-6">
                    <div className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-xl grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                      <div className="md:col-span-8 space-y-4">
                        <h4 className="text-xs uppercase font-bold text-zinc-400">Plan Quality Checklist</h4>
                        <div className="space-y-2">
                          {[
                            { label: "Dependency Coverage", v: evaluationResult.checklist.dependencies_covered },
                            { label: "Risk Analysis", v: evaluationResult.checklist.risks_identified },
                            { label: "Rollback Plan", v: evaluationResult.checklist.rollback_included },
                            { label: "Open Questions", v: evaluationResult.checklist.unknowns_acknowledged },
                            { label: "Clarification Requested", v: evaluationResult.checklist.clarification_requested },
                            { label: "Confidence Explanation", v: evaluationResult.checklist.confidence_explained }
                          ].map(chk => (
                            <div key={chk.label} className="flex justify-between items-center text-xs border-b border-zinc-900 pb-1.5 last:border-0">
                              <span className="text-zinc-400">{chk.label}</span>
                              <span className={`font-bold ${chk.v ? "text-emerald-450" : "text-rose-450"}`}>{chk.v ? "Pass" : "Fail"}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="md:col-span-4 flex flex-col items-center justify-center space-y-2">
                        <div className="w-28 h-28 rounded-full border-4 border-indigo-500 flex flex-col items-center justify-center bg-zinc-950 shadow-xl">
                          <span className="text-3xl font-black text-white">{evaluationResult.score}</span>
                          <span className="text-[9px] text-zinc-500 font-bold uppercase">/100</span>
                        </div>
                      </div>
                    </div>

                    {evaluationResult.feedback && evaluationResult.feedback.length > 0 && (
                      <div className="bg-zinc-900/30 border border-zinc-900 p-5 rounded-xl space-y-3">
                        <h4 className="text-xs uppercase font-bold text-zinc-400">Evaluator Feedback</h4>
                        <div className="space-y-2">
                          {evaluationResult.feedback.map((fb, i) => (
                            <div key={i} className="text-xs text-zinc-400 leading-relaxed flex items-start gap-2">
                              <span className="text-zinc-600 shrink-0">•</span>
                              <span>{fb}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {evaluationResult.expected_affected_files && evaluationResult.expected_affected_files.length > 0 && (
                      <div className="bg-zinc-900/30 border border-zinc-900 p-5 rounded-xl space-y-3">
                        <h4 className="text-xs uppercase font-bold text-zinc-400">Expected Affected Files</h4>
                        <div className="flex flex-wrap gap-2">
                          {evaluationResult.expected_affected_files.map((file, i) => (
                            <span key={i} className="px-2 py-1 bg-zinc-950 border border-zinc-900 rounded text-[10px] font-mono text-indigo-400">{file}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {evaluationResult.missing_files && evaluationResult.missing_files.length > 0 && (
                      <div className="bg-zinc-900/30 border border-zinc-900 p-5 rounded-xl space-y-3">
                        <h4 className="text-xs uppercase font-bold text-rose-400">Missing Files (Not Referenced in Plan)</h4>
                        <div className="flex flex-wrap gap-2">
                          {evaluationResult.missing_files.map((file, i) => (
                            <span key={i} className="px-2 py-1 bg-rose-950 border border-rose-900 rounded text-[10px] font-mono text-rose-400">{file}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB: SETTINGS */}
            {activeTab === "settings" && (
              <div className="flex-1 p-8 overflow-y-auto space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Settings</h2>
                  <p className="text-xs text-zinc-500">Configure connection strings, API tokens, and indexing schedules.</p>
                </div>
                <div className="bg-zinc-900/30 border border-zinc-900 p-6 rounded-xl max-w-4xl space-y-4 text-xs">
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-2">Google OpenRouter API Key</label>
                    <input
                      type="password"
                      readOnly
                      value="••••••••••••••••••••••••••••••••"
                      className="px-3 py-2 bg-zinc-950 border border-zinc-900 rounded-lg text-zinc-300 w-full max-w-md focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-2">Default Planning Model</label>
                    <select className="bg-zinc-950 border border-zinc-900 rounded-lg px-3 py-2 text-zinc-300 w-full max-w-md">
                      <option>google/gemini-2.5-pro</option>
                      <option>google/gemini-2.5-flash</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

          </main>
        </div>
      )}

    </div>
  );
}
