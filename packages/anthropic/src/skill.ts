/** Typed authoring helpers for Claude-compatible skills. */

/** Skill declaration that can be emitted as `SKILL.md`. */
export type ClaudeSkillDefinition = {
  name: string;
  description: string;
  body: string;
};

/** Declares a Claude-compatible skill. */
export function skill(
  definition: ClaudeSkillDefinition,
): ClaudeSkillDefinition {
  return Object.freeze(definition);
}
