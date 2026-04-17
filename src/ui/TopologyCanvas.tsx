import { Globe, Server, Database } from "lucide-react";

export interface TopologyNode {
  id: string;
  name: string;
  type: "gateway" | "service" | "db";
  status: "running" | "error";
  x: number;
  y: number;
}

interface TopologyCanvasProps {
  nodes: TopologyNode[];
  highlightedNode: string | null;
}

export function TopologyCanvas({ nodes, highlightedNode }: TopologyCanvasProps) {
  return (
    <div className="flex-1 bg-gray-50 p-6 relative overflow-hidden">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">应用拓扑</h2>

      <div className="relative w-full h-[400px] bg-white border border-gray-200 rounded-lg shadow-inner">
        {/* 连线 */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <path d="M 90 170 L 250 100" stroke="#cbd5e1" strokeWidth="2" fill="none" />
          <path d="M 90 170 L 250 240" stroke="#cbd5e1" strokeWidth="2" fill="none" />
          <path d="M 290 240 L 450 240" stroke="#cbd5e1" strokeWidth="2" fill="none" />
        </svg>

        {/* 节点 */}
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`absolute flex flex-col items-center justify-center w-32 h-16 bg-white border-2 rounded-lg shadow-sm transition-all duration-500
              ${node.status === "error" ? "border-red-500 bg-red-50" : "border-gray-200"}
              ${highlightedNode === node.id ? "ring-4 ring-blue-400 ring-opacity-50 scale-105" : ""}
            `}
            style={{ left: node.x, top: node.y }}
          >
            <div className="flex items-center space-x-2">
              {node.type === "gateway" && <Globe className="w-4 h-4 text-blue-500" />}
              {node.type === "service" && <Server className="w-4 h-4 text-purple-500" />}
              {node.type === "db" && <Database className="w-4 h-4 text-green-500" />}
              <span className="font-medium text-xs text-gray-700">{node.name}</span>
            </div>
            <div className="mt-1 flex items-center space-x-1">
              {node.status === "running" ? (
                <>
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span className="text-[10px] text-gray-500">运行中</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                  <span className="text-[10px] text-red-600 font-semibold">异常</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
