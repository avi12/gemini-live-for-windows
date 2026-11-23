<script lang="ts">
  // The theme is a sheet of the whole window. winui-svelte makes a window sheet only of a `.css` file
  // imported by a relative path, so it is imported here, at the top, rather than from each component.
  import "./ui/theme.css";
  import PillWindow from "@/ui/window/PillWindow.svelte";
</script>

<PillWindow />
