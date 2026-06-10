<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="toast-list">
      <Transition
        v-for="t in toasts"
        :key="t.id"
        name="toast"
        appear
      >
        <div class="toast" :class="`toast--${t.type}`">
          <!-- Icon -->
          <svg class="toast__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <template v-if="t.type === 'success'">
              <polyline points="20 6 9 17 4 12"/>
            </template>
            <template v-else-if="t.type === 'error'">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </template>
            <template v-else-if="t.type === 'warn'">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </template>
            <template v-else>
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </template>
          </svg>

          <span class="toast__msg">{{ t.message }}</span>

          <button class="toast__close" @click="dismiss(t.id)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.toast-list {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  min-width: 280px;
  max-width: 480px;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: $glass-bg;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: $shadow-md;
  font-size: 13px;
  pointer-events: auto;
  min-width: 280px;

  &--info    { border-color: $color-border; color: $color-text-primary; .toast__icon { color: $color-accent; } }
  &--success { border-color: rgba(#22c55e, 0.3); color: $color-text-primary; .toast__icon { color: #22c55e; } }
  &--warn    { border-color: rgba(#f59e0b, 0.3); color: $color-text-primary; .toast__icon { color: #f59e0b; } }
  &--error   { border-color: rgba($color-danger, 0.3); color: $color-text-primary; .toast__icon { color: $color-danger; } }

  &__icon { flex-shrink: 0; }
  &__msg  { flex: 1; line-height: 1.4; }

  &__close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    color: $color-text-muted;
    cursor: pointer;
    border-radius: 4px;
    flex-shrink: 0;
    &:hover { background: $color-bg-hover; color: $color-text-primary; }
  }
}

.toast-enter-active { transition: all 0.25s ease; }
.toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from  { opacity: 0; transform: translateY(-12px); }
.toast-leave-to    { opacity: 0; transform: translateY(-8px); }
</style>
