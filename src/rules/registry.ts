import type { Rule } from "./engine.js";
import { noComments } from "./no-comments.js";
import { noCircularDeps } from "./no-circular-deps.js";
import { noDeadExports } from "./no-dead-exports.js";

/** Every rule the engine knows about. Add a rule = add a file + an entry here. */
export const ALL_RULES: Rule[] = [noComments, noCircularDeps, noDeadExports];
