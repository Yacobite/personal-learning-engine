import type { NodeType } from './curriculum.ts';
import type { Dimension } from './learner-state.ts';
const profiles: Record<NodeType, readonly Dimension[] | null> = {
    concept: ['memory_accessibility', 'structural_understanding', 'discrimination', 'application', 'transfer'],
    definition: ['memory_accessibility', 'structural_understanding', 'discrimination'],
    procedure: ['structural_understanding', 'application', 'transfer', 'procedural_fluency', 'scaffold_independence'],
    representation: ['structural_understanding', 'discrimination', 'representation_flexibility'],
    boundary_case: ['discrimination', 'application', 'transfer'],
    misconception: null,
    assessment_objective: null
};
export function competenceProfile(type: NodeType): readonly Dimension[] | null { return profiles[type]; }
