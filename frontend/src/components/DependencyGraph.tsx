"use client";

import React, { useMemo, useEffect } from "react";
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    MarkerType
} from "reactflow";
import "reactflow/dist/style.css";

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

interface DependencyGraphProps {
    nodesData: GraphNode[];
    edgesData: GraphEdge[];
    onNodeSelect?: (node: GraphNode) => void;
}

// Strict 8 node types — matching the graph builder schema
const neo4jNodeStyles: Record<string, { bg: string; border: string; text: string; label: string }> = {
    file:           { bg: "#0369a1", border: "#0ea5e9", text: "#f0f9ff", label: "File" },
    class:          { bg: "#047857", border: "#10b981", text: "#ecfdf5", label: "Class" },
    function:       { bg: "#0e7490", border: "#06b6d4", text: "#ecfeff", label: "Function" },
    service:        { bg: "#4f46e5", border: "#818cf8", text: "#ffffff", label: "Service" },
    api:            { bg: "#b45309", border: "#f59e0b", text: "#fffbeb", label: "API" },
    database_table: { bg: "#be123c", border: "#f43f5e", text: "#fff1f2", label: "Database Table" },
    external_api:   { bg: "#334155", border: "#64748b", text: "#f8fafc", label: "External API" },
    queue:          { bg: "#6b21a8", border: "#a855f7", text: "#faf5ff", label: "Queue" },
};

export default function DependencyGraph({ nodesData, edgesData, onNodeSelect }: DependencyGraphProps) {
    
    const initialNodes = useMemo(() => {
        const centerX = 400;
        const centerY = 320;

        // Layout: files in center ring, services/classes/APIs in middle ring, rest in outer ring
        const coreNodes: GraphNode[] = [];
        const middleNodes: GraphNode[] = [];
        const outerNodes: GraphNode[] = [];

        nodesData.forEach(node => {
            if (node.type === "file") {
                coreNodes.push(node);
            } else if (["class", "service", "api", "database_table", "queue"].includes(node.type)) {
                middleNodes.push(node);
            } else {
                outerNodes.push(node);
            }
        });

        const positions: Record<string, { x: number; y: number }> = {};

        coreNodes.forEach((node, i) => {
            const angle = (i / Math.max(coreNodes.length, 1)) * 2 * Math.PI;
            positions[node.id] = {
                x: centerX + 130 * Math.cos(angle),
                y: centerY + 130 * Math.sin(angle)
            };
        });

        middleNodes.forEach((node, i) => {
            const angle = (i / Math.max(middleNodes.length, 1)) * 2 * Math.PI;
            positions[node.id] = {
                x: centerX + 280 * Math.cos(angle),
                y: centerY + 280 * Math.sin(angle)
            };
        });

        outerNodes.forEach((node, i) => {
            const angle = (i / Math.max(outerNodes.length, 1)) * 2 * Math.PI;
            positions[node.id] = {
                x: centerX + 420 * Math.cos(angle),
                y: centerY + 420 * Math.sin(angle)
            };
        });

        return nodesData.map(node => {
            const pos = positions[node.id] || { x: centerX, y: centerY };
            const styleTheme = neo4jNodeStyles[node.type] || { bg: "#27272a", border: "#3f3f46", text: "#d4d4d8", label: "Unknown" };
            
            // Size based on importance
            let size = 70;
            if (node.type === "file") size = 90;
            else if (node.type === "service") size = 85;
            else if (node.type === "database_table" || node.type === "queue") size = 80;

            return {
                id: node.id,
                position: pos,
                data: { label: node.label },
                draggable: true,
                width: size,
                height: size,
                style: {
                    background: styleTheme.bg,
                    color: styleTheme.text,
                    border: `2px solid ${styleTheme.border}`,
                    borderRadius: "50%",
                    width: size,
                    height: size,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "9px",
                    fontWeight: "700",
                    textAlign: "center" as const,
                    lineHeight: "1.2",
                    padding: "6px",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.3)",
                    wordBreak: "break-word" as const,
                    overflow: "hidden",
                    cursor: "grab"
                }
            };
        });
    }, [nodesData]);

    const initialEdges = useMemo(() => {
        return edgesData.map((edge, i) => ({
            id: `e-${i}`,
            source: edge.source,
            target: edge.target,
            label: `:${edge.type.toUpperCase()}`,
            style: { stroke: "#6366f1", strokeWidth: 1.5, opacity: 0.6 },
            labelStyle: { 
                fill: "#818cf8", 
                fontSize: 6.5, 
                fontWeight: 800, 
                fontFamily: "monospace"
            },
            labelBgPadding: [4, 4] as [number, number],
            labelBgBorderRadius: 4,
            labelBgStyle: { fill: "#09090b", fillOpacity: 0.85, stroke: "#312e81", strokeWidth: 1 },
            animated: edge.type === "calls" || edge.type === "writes" || edge.type === "reads",
            markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "#6366f1",
            }
        }));
    }, [edgesData]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    const handleNodeClick = (_: any, rfNode: any) => {
        if (onNodeSelect) {
            const found = nodesData.find(n => n.id === rfNode.id);
            if (found) onNodeSelect(found);
        }
    };

    return (
        <div className="w-full h-full min-h-[500px] border border-zinc-900 rounded-xl overflow-hidden bg-zinc-950 relative flex">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                fitView
            >
                <Background color="#18181b" gap={16} size={1} />
                <Controls className="bg-zinc-900 border border-zinc-800 text-white rounded [&>button]:border-zinc-800 [&>button]:bg-zinc-900 hover:[&>button]:bg-zinc-800" />
                <MiniMap 
                    nodeColor={() => "#27272a"} 
                    maskColor="rgba(0, 0, 0, 0.8)" 
                    className="bg-zinc-900 border border-zinc-800 rounded"
                />
            </ReactFlow>

            {/* Color Legend — strict 8 types */}
            <div className="absolute bottom-4 left-4 bg-zinc-950/80 border border-zinc-850 p-4 rounded-lg backdrop-blur-md space-y-2 pointer-events-none shadow-xl">
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Node Types</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[9px] font-semibold text-zinc-300">
                  {Object.entries(neo4jNodeStyles).map(([type, theme]) => (
                    <div key={type} className="flex items-center gap-1.5">
                      <span 
                        className="w-2.5 h-2.5 rounded-full border" 
                        style={{ background: theme.bg, borderColor: theme.border }} 
                      />
                      <span>{theme.label}</span>
                    </div>
                  ))}
                </div>
            </div>
        </div>
    );
}
