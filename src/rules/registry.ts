import type { Rule } from "./engine.js";
import { noComments } from "./no-comments.js";
import { noCircularDeps } from "./no-circular-deps.js";
import { noDeadFiles, noUnusedDeps, noUnusedMembers, noUnusedTypes } from "./dead-code.js";
import { noDeadExports } from "./no-dead-exports.js";

/** Every rule the engine knows about. Add a rule = add a file + an entry here. */
export const ALL_RULES: Rule[] = [
  noComments,
  noCircularDeps,
  noDeadExports,
  noDeadFiles,
  noUnusedTypes,
  noUnusedMembers,
  noUnusedDeps,
];
