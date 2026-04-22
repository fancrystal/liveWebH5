<script setup lang="ts">
import { useWhiteboardStore } from '@/stores/whiteboardStore'

const wbStore = useWhiteboardStore()
</script>

<template>
  <div class="wb-tabs no-select">
    <div class="wb-tabs__list">
      <div
        v-for="page in wbStore.pages"
        :key="page.id"
        class="wb-tabs__tab"
        :class="{ active: wbStore.activePageId === page.id }"
        @click="wbStore.switchPage(page.id)"
      >
        <span class="wb-tabs__label">{{ page.name }}</span>
        <button
          v-if="wbStore.pages.length > 1"
          class="wb-tabs__close"
          @click.stop="wbStore.removePage(page.id)"
        >×</button>
      </div>
    </div>

    <button class="wb-tabs__add" title="新增白板" @click="wbStore.addPage">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.wb-tabs {
  display: flex;
  align-items: center;
  background: #e8e8e8;
  border-bottom: 1px solid #d0d0d0;
  padding: 0 4px;
  flex-shrink: 0;
  height: 36px;

  &__list {
    display: flex;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    flex: 1;

    &::-webkit-scrollbar { height: 2px; }
  }

  &__tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px;
    height: 28px;
    border-radius: 6px 6px 0 0;
    background: transparent;
    color: #555;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;

    &:hover { background: rgba(0,0,0,0.06); }

    &.active {
      background: #fff;
      color: #111;
      font-weight: 500;
    }
  }

  &__label { pointer-events: none; }

  &__close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: none;
    background: transparent;
    color: #888;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    &:hover { background: rgba(0,0,0,0.1); color: #333; }
  }

  &__add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #666;
    cursor: pointer;
    flex-shrink: 0;
    &:hover { background: rgba(0,0,0,0.08); }
  }
}
</style>
