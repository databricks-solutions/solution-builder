/**
 * platform-diagram/node-types — the ReactFlow node + edge type registries,
 * wiring the canvas to the concrete node/edge components.
 */
import { ComponentNode } from "./nodes/component-node";
import { LakeflowBlock } from "./composite-lakeflow";
import { GenieCodeBlock } from "./composite-genie-code";
import { GovernanceBlock } from "./composite-governance";
import { LakeflowGenieBlock } from "./composite-lakeflow-genie";
import { AnnotationNode } from "./annotations";
import { FlowEdge } from "./edges/flow-edge";

export const nodeTypes = { component: ComponentNode, composite: LakeflowBlock, genieCode: GenieCodeBlock, governance: GovernanceBlock, lakeflowGenie: LakeflowGenieBlock, annotation: AnnotationNode };

export const edgeTypes = { flow: FlowEdge };
