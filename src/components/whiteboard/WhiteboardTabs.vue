<script setup lang="ts">
import { useWhiteboardStore } from '@/stores/whiteboardStore'

const wbStore = useWhiteboardStore()

function removePage(id: string, e: MouseEvent) {
  e.stopPropagation()
  if (wbStore.pages.length > 1) {
    wbStore.removePage(id)
  } else {
    // Last page — hide the whiteboard entirely (triggers camera maximize via App.vue)
    wbStore.toggleContentHidden()
  }
}
</script>

<template>
  <div class="wb-tabs no-select">
    <!-- Scrollable tab list -->
    <div class="wb-tabs__scroll">
      <div
        v-for="page in wbStore.pages"
        :key="page.id"
        class="wb-tabs__tab"
        :class="{ active: wbStore.activePageId === page.id }"
        @click="wbStore.switchPage(page.id)"
      >
        <span class="wb-tabs__label">{{ page.name }}</span>

        <!-- Every tab has a close button; active tab styled with accent color -->
        <button
          class="wb-tabs__close"
          :class="{ 'wb-tabs__close--active': wbStore.activePageId === page.id }"
          :title="`关闭 ${page.name}`"
          @click="removePage(page.id, $event)"
        >
          <svg width="7" height="7" viewBox="0 0 10 10" fill="none">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <!-- Add whiteboard button — inline after last tab -->
      <button class="wb-tabs__add" title="新增白板" @click="wbStore.addPage()">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.wb-tabs {
  display: flex;
  align-items: stretch;
  background: $color-bg-panel;
  border-bottom: 1px solid $color-border;
  flex-shrink: 0;
  height: 36px;

  &__scroll {
    display: flex;
    align-items: center;
    overflow-x: auto;
    flex: 1;
    min-width: 0;
    padding: 0 6px;
    gap: 2px;

    &::-webkit-scrollbar { height: 0; }
  }

  // Individual tab
  &__tab {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 12px;
    height: 26px;
    border-radius: 6px;
    cursor: pointer;
    color: $color-text-muted;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
    user-select: none;
    border: 1px solid transparent;

    &:hover {
      color: $color-text-secondary;
      background: $color-bg-hover;
    }

    &.active {
      color: $color-accent;
      background: rgba($color-accent, 0.1);
      border-color: rgba($color-accent, 0.25);
    }
  }

  &__label {
    pointer-events: none;
    line-height: 1;
  }

  // Round close button on every tab
  &__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: $color-text-muted;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: background 0.15s, color 0.15s;

    // Active tab: × tinted with accent color
    &--active {
      color: $color-accent;
      opacity: 0.7;
    }

    &:hover {
      background: rgba($color-danger, 0.18);
      color: $color-danger;
      opacity: 1;
    }
  }

  // + add button — inline after last tab
  &__add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 1px dashed $color-border;
    background: transparent;
    color: $color-text-muted;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 2px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;

    &:hover {
      background: rgba($color-success, 0.12);
      color: $color-success;
      border-color: rgba($color-success, 0.4);
    }
  }
}
</style>
