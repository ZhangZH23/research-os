import type { ContributionAssessment } from '../shared/program';
import ResearchText from './ResearchText';
import { researchTextLabel } from '../shared/math';
import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  type NodeProps,
  type Node,
  type Connection,
  MarkerType,
} from '@xyflow/react';
import type { ResearchNode, ResearchEdge } from '../shared/types';
import { Badge, TypeIcon } from './ui';
type GraphNode = Node<{ item: ResearchNode; warnings: number; contribution?: string }, 'research'>;
function ResearchCard({ data }: NodeProps<GraphNode>) {
  return (
    <div className={`graph-node ${data.item.epistemicStatus === 'Disproved' ? 'dim' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="graph-node-type">
        <TypeIcon type={data.item.type} size={13} />
        {data.item.type}
        {data.warnings > 0 && <span className="graph-alert">!</span>}
      </div>
      <strong>
        <ResearchText inline>{data.item.title}</ResearchText>
      </strong>
      <Badge status={data.item.epistemicStatus} />
      {data.contribution && <span className="graph-contribution">{data.contribution}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { research: ResearchCard };
const noAssessments: ContributionAssessment[] = [];
const columns: Record<string, number> = {
  'Source / Paper': 0,
  'Agent Run': 0,
  Note: 0,
  Lemma: 1,
  Experiment: 1,
  Counterexample: 1,
  Evidence: 2,
  'Open Question': 2,
  Claim: 3,
  Approach: 3,
  Theorem: 4,
  Conjecture: 5,
};
export default function Graph({
  nodes,
  edges,
  onSelect,
  onConnect,
  compact = false,
  assessments = noAssessments,
}: {
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  onSelect: (id: string) => void;
  onConnect: (c: Connection) => void;
  compact?: boolean;
  assessments?: ContributionAssessment[];
}) {
  const initial = useMemo(() => {
    const counts: Record<number, number> = {};
    return nodes.map((item) => {
      const col = columns[item.type];
      const row = counts[col] ?? 0;
      counts[col] = row + 1;
      return {
        id: item.id,
        type: 'research' as const,
        ariaLabel: researchTextLabel(item.title),
        data: {
          item,
          warnings: item.epistemicStatus === 'Proved' && !item.humanVerified ? 1 : 0,
          contribution: assessments.find((a) => a.nodeId === item.id)?.classification,
        },
        position: { x: col * 290, y: row * 215 + (col % 2) * 45 },
      };
    });
  }, [nodes, assessments]);
  const [flowNodes, setNodes, onNodesChange] = useNodesState<GraphNode>(initial);
  useEffect(() => setNodes(initial), [initial, setNodes]);
  const flowEdges = useMemo(
    () =>
      edges
        .filter(
          (e) =>
            nodes.some((n) => n.id === e.sourceNodeId) &&
            nodes.some((n) => n.id === e.targetNodeId),
        )
        .map((e) => ({
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          label: compact ? undefined : e.edgeType.replaceAll('_', ' '),
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: ['contradicts', 'disproves'].includes(e.edgeType) ? '#b45450' : '#78918b',
          },
          style: {
            stroke: ['contradicts', 'disproves'].includes(e.edgeType)
              ? '#b45450'
              : e.edgeType === 'supports'
                ? '#488572'
                : '#9eaaa7',
            strokeWidth: 1.5,
            strokeDasharray: e.edgeType === 'depends_on' ? '5 4' : undefined,
          },
          labelStyle: { fontSize: 11, fill: '#62716d' },
          labelBgStyle: { fill: '#f8faf9' },
        })),
    [nodes, edges, compact],
  );
  const click = useCallback((_: unknown, n: GraphNode) => onSelect(n.id), [onSelect]);
  return (
    <div className={`graph-canvas ${compact ? 'compact' : ''}`}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={click}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.15}
        maxZoom={1.7}
        nodesConnectable={!compact}
        panOnScroll={false}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={22} size={1} color="#cfd8d3" />
        <Controls showInteractive={false} />
        {!compact && <MiniMap pannable zoomable nodeColor="#9cb8ad" />}
      </ReactFlow>
      {!nodes.length && <div className="graph-empty">No items match these filters.</div>}
    </div>
  );
}
