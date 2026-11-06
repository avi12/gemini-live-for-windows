<script lang="ts">
  import { MenuFlyoutItem } from "winui-svelte/components";

  interface Props {
    title: string;
  }

  const props: Props = $props();
</script>

<MenuFlyoutItem class="menu-header" isEnabled={false} text={props.title} />

<style>
  .menu-header {
    font-weight: 500;
    font-size: 12px;
  }
</style>
