<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import { useI18n } from '@/i18n'
import type { WhiteboardTool } from '@/types/whiteboard'

const wbStore = useWhiteboardStore()
const { t }   = useI18n()

interface ToolItem {
  tool: WhiteboardTool | 'undo' | 'redo' | 'delete'
  label: string
  action?: () => void
}

const tools = computed<ToolItem[]>(() => [
  { tool: 'select', label: t('selectTool') },
  { tool: 'pen',    label: t('pen') },
  { tool: 'text',   label: t('text') },
  { tool: 'rect',   label: t('rect') },
  { tool: 'laser',  label: t('laser') },
  { tool: 'eraser', label: t('eraser') },
])

const actions = computed<ToolItem[]>(() => [
  { tool: 'undo',   label: t('undo'),  action: () => wbStore.fireUndo() },
  { tool: 'redo',   label: t('redo'),  action: () => wbStore.fireRedo() },
  { tool: 'delete', label: t('clear'), action: () => wbStore.fireClear() },
])

function handleClick(item: ToolItem) {
  if (['pen','text','rect','laser','eraser','select'].includes(item.tool)) {
    wbStore.setTool(item.tool as WhiteboardTool)
  }
  if (item.action) item.action()
}

// Show color palette when a color-sensitive tool is active
const showColors = computed(() =>
  ['pen', 'text', 'rect'].includes(wbStore.activeTool)
)

const COLORS = [
  '#000000', '#ffffff',
  '#ef4444', '#f97316',
  '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6',
  '#8b5cf6', '#ec4899',
  '#94a3b8', '#6b4c2a',
]

// Hidden native color input ref for custom picker
const colorInputEl = ref<HTMLInputElement | null>(null)

function onCustomColor(e: Event) {
  wbStore.updateToolOptions({ color: (e.target as HTMLInputElement).value })
}

function openCustomPicker() {
  colorInputEl.value?.click()
}
</script>

<template>
  <aside class="left-toolbar no-select">
    <!-- Drawing tools -->
    <div class="left-toolbar__group">
      <button
        v-for="item in tools"
        :key="item.tool"
        class="left-toolbar__btn"
        :class="{ active: wbStore.activeTool === item.tool }"
        :title="item.label"
        @click="handleClick(item)"
      >
        <!-- Color indicator dot on active color tool -->
        <span
          v-if="showColors && wbStore.activeTool === item.tool"
          class="left-toolbar__color-dot"
          :style="{ background: wbStore.toolOptions.color, borderColor: wbStore.toolOptions.color === '#ffffff' ? '#aaa' : 'transparent' }"
        />

        <!-- Select / scroll -->
        <svg v-if="item.tool === 'select'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 3l14 9-7 1-4 7z"/>
        </svg>
        <!-- Pen -->
        <svg v-else-if="item.tool === 'pen'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        <!-- Text -->
        <svg v-else-if="item.tool === 'text'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
        </svg>
        <!-- Rect -->
        <svg v-else-if="item.tool === 'rect'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        </svg>
        <!-- Laser -->
        <svg v-else-if="item.tool === 'laser'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
        </svg>
        <!-- Eraser -->
        <svg v-else-if="item.tool === 'eraser'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 20H7L3 16l9-9 8 8-2.5 2.5"/><path d="M6.0001 11 13 4"/>
        </svg>
      </button>
    </div>

    <!-- Color palette — visible when pen / text / rect is active -->
    <transition name="color-fade">
      <div v-if="showColors" class="left-toolbar__palette">
        <button
          v-for="c in COLORS"
          :key="c"
          class="left-toolbar__swatch"
          :class="{ selected: wbStore.toolOptions.color === c }"
          :style="{ background: c, borderColor: c === '#ffffff' ? '#666' : 'transparent' }"
          :title="c"
          @click="wbStore.updateToolOptions({ color: c })"
        />
        <!-- Custom color -->
        <button
          class="left-toolbar__swatch left-toolbar__swatch--custom"
          :style="{ background: COLORS.includes(wbStore.toolOptions.color) ? 'transparent' : wbStore.toolOptions.color }"
          :class="{ selected: !COLORS.includes(wbStore.toolOptions.color) }"
          title="自定义颜色"
          @click="openCustomPicker"
        >
          <svg v-if="COLORS.includes(wbStore.toolOptions.color)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </button>
        <!-- Hidden native color input -->
        <input
          ref="colorInputEl"
          type="color"
          :value="wbStore.toolOptions.color"
          class="left-toolbar__native-color"
          @input="onCustomColor"
        />
      </div>
    </transition>

    <div class="left-toolbar__divider" />

    <!-- History / delete actions -->
    <div class="left-toolbar__group">
      <button
        v-for="item in actions"
        :key="item.tool"
        class="left-toolbar__btn"
        :class="{
          disabled: item.tool === 'undo' && !wbStore.canUndo,
          disabled2: item.tool === 'redo' && !wbStore.canRedo,
        }"
        :title="item.label"
        @click="handleClick(item)"
      >
        <!-- Undo -->
        <svg v-if="item.tool === 'undo'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
        </svg>
        <!-- Redo -->
        <svg v-else-if="item.tool === 'redo'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>
        </svg>
        <!-- Delete -->
        <svg v-else-if="item.tool === 'delete'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.left-toolbar {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: $left-toolbar-width;
  background: $color-bg-panel;
  border-right: 1px solid $color-border;
  padding: 8px 0;
  gap: 2px;
  flex-shrink: 0;
  overflow: visible;

  &__group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 100%;
    padding: 0 4px;
  }

  &__divider {
    width: 24px;
    height: 1px;
    background: $color-border;
    margin: 6px 0;
  }

  &__btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: $color-text-secondary;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      background: $color-bg-hover;
      color: $color-text-primary;
    }

    &.active {
      background: $color-accent;
      color: #fff;
    }

    &.disabled,
    &.disabled2 {
      opacity: 0.35;
      pointer-events: none;
    }
  }

  // Small color dot on active color-sensitive tool button
  &__color-dot {
    position: absolute;
    bottom: 3px;
    right: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1px solid transparent;
    pointer-events: none;
    z-index: 1;
  }

  // ── Color palette ──────────────────────────────────────────────────────────
  &__palette {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px;
    width: 100%;
  }

  &__swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1.5px solid transparent;
    cursor: pointer;
    padding: 0;
    transition: transform 0.1s, box-shadow 0.1s;
    display: flex;
    align-items: center;
    justify-content: center;
    justify-self: center;

    &:hover { transform: scale(1.2); }

    &.selected {
      box-shadow: 0 0 0 2px $color-accent;
      transform: scale(1.15);
    }

    &--custom {
      background: transparent;
      border: 1.5px dashed $color-border;
      color: $color-text-muted;

      &:hover { border-color: $color-text-secondary; color: $color-text-primary; }
      &.selected { box-shadow: 0 0 0 2px $color-accent; border-style: solid; }
    }
  }

  &__native-color {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }
}

// Transition
.color-fade-enter-active,
.color-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.color-fade-enter-from,
.color-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
