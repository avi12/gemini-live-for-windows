import { svelte } from "eslint-config-avi12/svelte";

export default svelte({ ignores: [".fallow/", "pill/dist/", "app/dist/", "bridge/dist/", ".claude/worktrees/"] });
