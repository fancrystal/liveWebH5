<script setup lang="ts">
import { ref } from 'vue'
import { useDocManager } from '@/composables/useDocManager'

const { openDocs, activeDocId, activeDoc, isLoading, loadFile, closeDoc, setActiveDoc, setCurrentPage } = useDocManager()
const fileInput = ref<HTMLInputElement | null>(null)

function triggerUpload() { fileInput.value?.click() }

async function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) await loadFile(file)
  // Reset so the same file can be re-selected next time
  if (fileInput.value) fileInput.value.value = ''
}

function onThumbnailClick(page: number) {
  setCurrentPage(page)
}
</script>

<template>
  <aside class="doc-sidebar no-select">
    <!-- Open document button -->
    <button class="doc-sidebar__new-btn" :disabled="isLoading" @click="triggerUpload">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="12" y1="18" x2="12" y2="12"/>
        <line x1="9" y1="15" x2="15" y2="15"/>
      </svg>
      打开新文档
    </button>
    <input ref="fileInput" type="file" accept=".pdf" class="doc-sidebar__file-input" @change="onFileChange" />

    <!-- Loading -->
    <div v-if="isLoading" class="doc-sidebar__loading">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="doc-sidebar__spin">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      <span>加载中...</span>
    </div>

    <!-- Open document list -->
    <div class="doc-sidebar__docs">
      <div v-if="openDocs.length === 0 && !isLoading" class="doc-sidebar__empty">
        暂无文档内容
      </div>

      <div
        v-for="doc in openDocs"
        :key="doc.id"
        class="doc-sidebar__doc-item"
        :class="{ active: doc.id === activeDocId }"
        @click="setActiveDoc(doc.id)"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="doc-sidebar__doc-icon">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="doc-sidebar__doc-name" :title="doc.name">{{ doc.name }}</span>
        <button class="doc-sidebar__doc-close" @click.stop="closeDoc(doc.id)">×</button>
      </div>
    </div>

    <!-- Page thumbnails for the active document -->
    <div v-if="activeDoc" class="doc-sidebar__thumbnails">
      <div
        v-for="(thumb, idx) in activeDoc.thumbnails"
        :key="idx"
        class="doc-sidebar__thumb"
        :class="{ active: activeDoc.currentPage === idx + 1 }"
        @click="onThumbnailClick(idx + 1)"
      >
        <img :src="thumb" :alt="`第 ${idx + 1} 页`" class="doc-sidebar__thumb-img" />
        <span class="doc-sidebar__thumb-num">{{ idx + 1 }}</span>
      </div>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.doc-sidebar {
  width: 160px;
  background: $color-bg-panel;
  border-right: 1px solid $color-border;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;

  // ── New-doc button ──────────────────────────────────────────────────────────
  &__new-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px;
    padding: 7px 10px;
    background: $color-accent;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;

    &:hover:not(:disabled) { background: $color-accent-hover; }
    &:disabled { opacity: 0.6; cursor: not-allowed; }
  }

  &__file-input { display: none; }

  // ── Loading ─────────────────────────────────────────────────────────────────
  &__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    font-size: 11px;
    color: $color-text-muted;
    flex-shrink: 0;
  }

  &__spin {
    animation: spin 1s linear infinite;
    flex-shrink: 0;
  }

  // ── Document list ────────────────────────────────────────────────────────────
  &__docs {
    flex-shrink: 0;
    border-bottom: 1px solid $color-border;
    max-height: 160px;
    overflow-y: auto;
    overflow-x: hidden;

    &::-webkit-scrollbar { width: 3px; }
    &::-webkit-scrollbar-thumb { background: $color-border; border-radius: 2px; }
  }

  &__empty {
    padding: 12px 10px;
    font-size: 11px;
    color: $color-text-muted;
    text-align: center;
  }

  &__doc-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 8px;
    cursor: pointer;
    transition: background 0.1s;

    &:hover { background: $color-bg-hover; }

    &.active {
      background: $color-bg-active;

      .doc-sidebar__doc-name { color: $color-accent; }
      .doc-sidebar__doc-icon { color: $color-accent; }
    }
  }

  &__doc-icon {
    flex-shrink: 0;
    color: $color-text-muted;
  }

  &__doc-name {
    flex: 1;
    font-size: 11px;
    color: $color-text-secondary;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__doc-close {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    color: $color-text-muted;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    padding: 0;
    transition: all 0.1s;

    &:hover {
      background: rgba(255, 255, 255, 0.08);
      color: $color-text-primary;
    }
  }

  // ── Page thumbnails ──────────────────────────────────────────────────────────
  &__thumbnails {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;

    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: $color-border; border-radius: 2px; }
  }

  &__thumb {
    position: relative;
    cursor: pointer;
    border-radius: 4px;
    overflow: hidden;
    border: 2px solid transparent;
    transition: border-color 0.15s, transform 0.1s;

    &:hover { border-color: rgba($color-accent, 0.5); transform: scale(1.02); }
    &.active { border-color: $color-accent; }
  }

  &__thumb-img {
    width: 100%;
    display: block;
    border-radius: 2px;
  }

  &__thumb-num {
    position: absolute;
    bottom: 3px;
    right: 4px;
    font-size: 10px;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1.4;
    pointer-events: none;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
