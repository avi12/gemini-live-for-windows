import { svelte } from "lint-config/eslint/svelte";

export default svelte({ ignores: [".fallow/", "pill/dist/", "app/dist/", "bridge/dist/", ".claude/worktrees/"] });
