<script setup lang="ts">
import { ref, nextTick, watch, onMounted, inject, computed } from 'vue'
import { useChatStore } from '@/stores/chatStore'
import { useCoStreamStore } from '@/stores/coStreamStore'
import { useI18n } from '@/i18n'
import type { ChatMessage } from '@/types/chat'
import type { useCoStream } from '@/composables/useCoStream'

/** Cap the number of chat messages rendered in the DOM */
const MAX_VISIBLE_MESSAGES = 100

const chatStore     = useChatStore()
const coStreamStore = useCoStreamStore()
const coStream      = inject<ReturnType<typeof useCoStream>>('coStream')
const { t }         = useI18n()

/** Only render the last N messages to avoid large DOM trees */
const visibleMessages = computed(() => {
  const msgs = chatStore.filteredMessages
  return msgs.slice(Math.max(0, msgs.length - MAX_VISIBLE_MESSAGES))
})

type PanelTab = 'chat' | 'product' | 'costream'
const activeTab = ref<PanelTab>('chat')

const inputText = ref('')
const messagesEl = ref<HTMLDivElement | null>(null)

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}

watch(() => chatStore.filteredMessages.length, scrollToBottom)
watch(() => activeTab.value, (tab) => {
  if (tab === 'chat') {
    chatStore.clearUnread()
    scrollToBottom()
  }
})

function sendMessage() {
  const text = inputText.value.trim()
  if (!text) return
  const msg: ChatMessage = {
    id: `local-${Date.now()}`,
    roomId: 'room-1',
    senderId: 'host',
    senderNickname: '主播',
    senderAvatar: '',
    content: text,
    type: 'text',
    timestamp: Date.now(),
    isPinned: false,
    isPrivate: false,
  }
  chatStore.addMessage(msg)
  inputText.value = ''
}

function toggleCoStream() {
  if (!coStream) return
  if (coStreamStore.isCoStreaming) {
    coStream.stop()
    coStreamStore.isCoStreaming = false
  } else {
    coStream.start()
    coStreamStore.isCoStreaming = true
  }
}

onMounted(() => {
  chatStore.clearUnread()
  scrollToBottom()
})

// costream is hidden for now
// product is hidden for this release (商品功能本版本不上线，恢复时取消注释即可)
const tabs = computed(() => [
  { id: 'chat'    as const, label: t('chatTab') },
  // { id: 'product' as const, label: '商品' },
])

// ─── Product card ──────────────────────────────────────────────────────────
interface Product {
  id: string
  name: string
  price: string
  originalPrice: string
  imageUrl: string
  link: string
}

const products = ref<Product[]>([])
const highlightedId = ref<string | null>(null)
const showProductForm = ref(false)
const editingProduct = ref<Product | null>(null)

const draftProduct = ref<Omit<Product, 'id'>>({
  name: '', price: '', originalPrice: '', imageUrl: '', link: '',
})

function openAddProduct() {
  editingProduct.value = null
  draftProduct.value = { name: '', price: '', originalPrice: '', imageUrl: '', link: '' }
  showProductForm.value = true
}

function openEditProduct(p: Product) {
  editingProduct.value = p
  draftProduct.value = { name: p.name, price: p.price, originalPrice: p.originalPrice, imageUrl: p.imageUrl, link: p.link }
  showProductForm.value = true
}

function saveProduct() {
  const d = draftProduct.value
  if (!d.name.trim() || !d.price.trim()) return
  if (editingProduct.value) {
    const idx = products.value.findIndex(p => p.id === editingProduct.value!.id)
    if (idx !== -1) products.value[idx] = { ...d, id: editingProduct.value.id }
  } else {
    products.value.push({ ...d, id: `prod-${Date.now()}` })
  }
  showProductForm.value = false
}

function removeProduct(id: string) {
  products.value = products.value.filter(p => p.id !== id)
  if (highlightedId.value === id) highlightedId.value = null
}

function toggleHighlight(id: string) {
  highlightedId.value = highlightedId.value === id ? null : id
}
</script>

<template>
  <div class="right-panel no-select">
    <!-- Side tab bar -->
    <div class="right-panel__tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="right-panel__tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        <!-- Chat icon -->
        <svg v-if="tab.id === 'chat'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <!-- Product icon -->
        <svg v-else-if="tab.id === 'product'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>
        <span class="right-panel__tab-label">{{ tab.label }}</span>
        <span
          v-if="tab.id === 'chat' && chatStore.unreadCount > 0 && activeTab !== 'chat'"
          class="right-panel__badge"
        >{{ chatStore.unreadCount > 99 ? '99+' : chatStore.unreadCount }}</span>
      </button>
    </div>

    <!-- Panel content -->
    <div class="right-panel__content">

      <!-- Chat Panel -->
      <template v-if="activeTab === 'chat'">
        <div class="panel-header">
          <div class="panel-header__tabs">
            <button
              class="panel-header__tab"
              :class="{ active: chatStore.filter === 'all' }"
              @click="chatStore.setFilter('all'); chatStore.clearUnread()"
            >{{ t('publicChat') }}</button>
            <!-- 私聊互动：本版本不上线，恢复时取消注释即可
            <button
              class="panel-header__tab"
              :class="{ active: chatStore.filter === 'private' }"
              @click="chatStore.setFilter('private')"
            >{{ t('privateChat') }}</button>
            -->

          </div>
        </div>

        <div ref="messagesEl" class="chat-messages">
          <div v-if="chatStore.filteredMessages.length === 0" class="chat-empty">
            <!-- Illustration: stacked chat bubbles -->
            <svg class="chat-empty__illustration" width="96" height="84" viewBox="0 0 96 84" fill="none" aria-hidden="true">
              <!-- back bubble -->
              <path
                d="M30 8h50a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H62l-8 9v-9H30a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z"
                fill="currentColor" opacity="0.08"
              />
              <!-- front bubble -->
              <path
                d="M16 26h44a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H36l-9 10v-10H16a8 8 0 0 1-8-8V34a8 8 0 0 1 8-8z"
                fill="currentColor" opacity="0.16"
              />
              <!-- typing dots in front bubble -->
              <circle cx="26" cy="44" r="3.2" fill="currentColor" opacity="0.45"/>
              <circle cx="38" cy="44" r="3.2" fill="currentColor" opacity="0.35"/>
              <circle cx="50" cy="44" r="3.2" fill="currentColor" opacity="0.25"/>
              <!-- sparkle accents -->
              <path d="M84 52l1.8 4.2L90 58l-4.2 1.8L84 64l-1.8-4.2L78 58l4.2-1.8z" fill="currentColor" opacity="0.3"/>
              <circle cx="14" cy="14" r="2.5" fill="currentColor" opacity="0.2"/>
            </svg>
            <div class="chat-empty__title">{{ t('emptyChatTitle') }}</div>
            <div class="chat-empty__hint">{{ t('emptyChatHint') }}</div>
          </div>
          <!-- Overflow hint -->
          <div
            v-if="chatStore.filteredMessages.length > MAX_VISIBLE_MESSAGES"
            class="chat-messages__overflow"
          >
            {{ t('onlyNewest')(MAX_VISIBLE_MESSAGES, chatStore.filteredMessages.length) }}
          </div>
          <div
            v-for="msg in visibleMessages"
            :key="msg.id"
            class="chat-msg"
          >
            <div class="chat-msg__avatar" :style="{ background: msg.senderId === 'host' ? '#ef4444' : '#3b82f6' }">
              {{ msg.senderNickname[0] }}
            </div>
            <div class="chat-msg__body">
              <span class="chat-msg__name">
                {{ msg.senderNickname }}
                <span v-if="msg.senderId === 'host'" class="chat-msg__host-tag">{{ t('live') }}</span>
              </span>
              <p class="chat-msg__text">{{ msg.content }}</p>
            </div>
          </div>
        </div>

        <!-- Pinned message -->
        <div v-if="chatStore.pinnedMessage" class="chat-pinned">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          {{ chatStore.pinnedMessage.content }}
        </div>

        <!-- Input -->
        <div class="chat-input">
          <input
            v-model="inputText"
            class="chat-input__field"
            :placeholder="t('sayHello')"
            maxlength="200"
            @keyup.enter="sendMessage"
          />
          <button class="chat-input__send" @click="sendMessage">{{ t('send') }}</button>
        </div>
      </template>

      <!-- Product Panel -->
      <template v-else-if="activeTab === 'product'">
        <div class="panel-header">
          <span class="panel-header__title">商品列表</span>
          <button class="product-add-btn" @click="openAddProduct">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            添加商品
          </button>
        </div>

        <!-- Add / Edit form -->
        <div v-if="showProductForm" class="product-form product-form--panel">
          <div class="product-form__title">{{ editingProduct ? '编辑商品' : '添加商品' }}</div>
          <div class="product-form__row">
            <input v-model="draftProduct.name" class="product-form__input" placeholder="商品名称 *" maxlength="60" />
          </div>
          <div class="product-form__row product-form__row--2col">
            <input v-model="draftProduct.price" class="product-form__input" placeholder="售价 *" maxlength="20" />
            <input v-model="draftProduct.originalPrice" class="product-form__input" placeholder="原价（划线）" maxlength="20" />
          </div>
          <div class="product-form__row">
            <input v-model="draftProduct.imageUrl" class="product-form__input" placeholder="图片链接（可选）" maxlength="500" />
          </div>
          <div class="product-form__row">
            <input v-model="draftProduct.link" class="product-form__input" placeholder="商品链接（可选）" maxlength="500" />
          </div>
          <!-- Image preview -->
          <div v-if="draftProduct.imageUrl" class="product-form__preview">
            <img :src="draftProduct.imageUrl" alt="preview" />
          </div>
          <div class="product-form__actions">
            <button class="product-form__cancel" @click="showProductForm = false">取消</button>
            <button class="product-form__save" @click="saveProduct">保存</button>
          </div>
        </div>

        <!-- Product list -->
        <div class="product-panel-list">
          <div v-if="products.length === 0 && !showProductForm" class="product-panel-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            <p>暂无商品</p>
            <p>点击右上角「添加商品」</p>
          </div>

          <div
            v-for="p in products"
            :key="p.id"
            class="product-card"
            :class="{ 'product-card--highlighted': highlightedId === p.id }"
          >
            <!-- Image -->
            <div class="product-card__img">
              <img v-if="p.imageUrl" :src="p.imageUrl" :alt="p.name" />
              <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <!-- Info -->
            <div class="product-card__info">
              <p class="product-card__name">{{ p.name }}</p>
              <div class="product-card__price-row">
                <span class="product-card__price">¥{{ p.price }}</span>
                <span v-if="p.originalPrice" class="product-card__original">¥{{ p.originalPrice }}</span>
              </div>
              <a v-if="p.link" :href="p.link" target="_blank" class="product-card__link">查看链接</a>
            </div>
            <!-- Actions -->
            <div class="product-card__actions">
              <button
                class="product-card__highlight-btn"
                :class="{ active: highlightedId === p.id }"
                @click="toggleHighlight(p.id)"
              >
                {{ highlightedId === p.id ? '展示中' : '展示' }}
              </button>
              <div class="product-card__icon-row">
                <button class="product-card__icon-btn" title="编辑" @click="openEditProduct(p)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button class="product-card__icon-btn product-card__icon-btn--del" title="删除" @click="removeProduct(p.id)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- CoStream Panel -->
      <template v-else-if="activeTab === 'costream'">
        <div class="panel-header">
          <span class="panel-header__title">{{ t('costreamTitle') }}</span>
          <span class="panel-header__count">{{ coStreamStore.participantCount }}/8</span>
        </div>

        <!-- Start / stop controls -->
        <div class="costream-actions">
          <button
            class="costream-btn"
            :class="coStreamStore.isCoStreaming ? 'costream-btn--danger' : 'costream-btn--guest'"
            @click="toggleCoStream"
          >
            {{ coStreamStore.isCoStreaming ? t('endCostream') : t('startCostream') }}
          </button>
          <!-- Demo helpers (visible only when co-streaming) -->
          <template v-if="coStreamStore.isCoStreaming">
            <button class="costream-btn costream-btn--outline" @click="coStream?.addDemoParticipant()">
              {{ t('addDemoGuest') }}
            </button>
            <button
              v-if="coStreamStore.participantCount > 0"
              class="costream-btn costream-btn--outline"
              @click="coStream?.removeDemoParticipant()"
            >
              {{ t('removeDemoGuest') }}
            </button>
          </template>
        </div>

        <!-- Apply list -->
        <template v-if="coStreamStore.applyCount > 0">
          <div class="costream-section-label">{{ t('applyLabel') }} ({{ coStreamStore.applyCount }})</div>
          <div class="costream-apply-list">
            <div
              v-for="p in coStreamStore.applyList"
              :key="p.id"
              class="costream-apply-item"
            >
              <div class="costream-item__avatar">{{ p.nickname[0] }}</div>
              <span class="costream-item__name">{{ p.nickname }}</span>
              <button class="costream-apply-item__btn costream-apply-item__btn--accept"
                @click="coStream?.acceptApply(p.id)">{{ t('accept') }}</button>
              <button class="costream-apply-item__btn costream-apply-item__btn--reject"
                @click="coStream?.rejectApply(p.id)">{{ t('reject') }}</button>
            </div>
          </div>
        </template>

        <!-- Stats -->
        <div class="costream-stats">
          <span>{{ t('participantLabel') }} ({{ coStreamStore.participantCount }})</span>
        </div>

        <!-- Participant list -->
        <div class="costream-list">
          <div
            v-for="p in coStreamStore.participantList"
            :key="p.id"
            class="costream-item"
          >
            <div class="costream-item__avatar">{{ p.nickname[0] }}</div>
            <span class="costream-item__name">
              {{ p.nickname }}
              <small v-if="p.role === 'guest'" class="costream-item__role-tag">{{ t('guestTag') }}</small>
              <small v-else-if="p.role === 'audience'" class="costream-item__role-tag">{{ t('audienceTag') }}</small>
            </span>
            <div class="costream-item__controls">
              <!-- Toggle audio -->
              <button
                class="costream-item__ctrl"
                :class="{ muted: !p.audioEnabled }"
                :title="p.audioEnabled ? '静音' : '开麦'"
                @click="coStream?.toggleParticipantAudio(p.id)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path v-if="p.audioEnabled" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path v-if="p.audioEnabled" d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line v-if="!p.audioEnabled" x1="1" y1="1" x2="23" y2="23"/>
                  <path v-if="!p.audioEnabled" d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                </svg>
              </button>
              <!-- Kick -->
              <button
                class="costream-item__ctrl costream-item__ctrl--kick"
                title="踢出连麦"
                @click="coStream?.kickParticipant(p.id)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div v-if="coStreamStore.participantCount === 0" class="costream-empty">
            {{ coStreamStore.isCoStreaming ? t('waitingGuests') : t('notStarted') }}
          </div>
        </div>

        <div class="costream-footer">
          <button class="costream-footer__btn" @click="coStreamStore.unmuteAll">{{ t('unmuteAll') }}</button>
          <button class="costream-footer__btn" @click="coStreamStore.muteAll">{{ t('muteAll') }}</button>
        </div>
      </template>

    </div>
  </div>
</template>

<style lang="scss" scoped>
.right-panel {
  display: flex;
  width: $right-panel-width + $right-tab-width;
  border-left: 1px solid $color-border;
  flex-shrink: 0;

  &__tabs {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: $right-tab-width;
    background: $color-bg-panel;
    border-right: 1px solid $color-border;
    padding: 8px 0;
    gap: 4px;
  }

  &__tab {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 50px;
    height: 58px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: $color-text-secondary;
    font-size: 11px;
    line-height: 1.3;
    text-align: center;
    cursor: pointer;
    transition: all 0.15s;
    white-space: pre-line;

    &:hover { background: $color-bg-hover; color: $color-text-primary; }
    &.active { background: $color-bg-active; color: $color-accent; }
  }

  &__tab-label {
    font-size: 11px;
    line-height: 1.3;
  }

  &__badge {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    border-radius: 8px;
    background: $color-danger;
    color: #fff;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    width: $right-panel-width;
    background: $color-bg-dark;
    overflow: hidden;
  }
}

// Panel header
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 0;
  flex-shrink: 0;

  &__tabs {
    display: flex;
    gap: 16px;
  }

  &__tab {
    padding: 0 0 8px;
    border: none;
    background: transparent;
    color: $color-text-secondary;
    font-size: 14px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;

    &.active {
      color: $color-text-primary;
      border-bottom-color: $color-accent;
    }
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $color-text-primary;
  }

  &__icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: $color-text-secondary;
    cursor: pointer;
    &:hover { background: $color-bg-hover; color: $color-text-primary; }
  }
}

// Chat
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__overflow {
    padding: 4px 8px;
    font-size: 11px;
    color: $color-text-muted;
    text-align: center;
    background: rgba($color-accent, 0.06);
    border-radius: 4px;
    flex-shrink: 0;
  }
}

// ─── Chat empty state ────────────────────────────────────────────────────────
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding-bottom: 32px;   // optical centering — input bar below pulls weight down
  color: $color-text-secondary;

  &__illustration {
    color: $color-text-primary;
    margin-bottom: 12px;
  }

  &__title {
    font-size: 14px;
    font-weight: 500;
    color: $color-text-secondary;
  }

  &__hint {
    font-size: 12px;
    color: $color-text-muted;
  }
}

.chat-msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;

  &__avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: $color-accent;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    flex-shrink: 0;
  }

  &__body { flex: 1; min-width: 0; }

  &__name {
    font-size: 12px;
    color: $color-text-muted;
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
  }

  &__host-tag {
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(#ef4444, 0.2);
    color: #ef4444;
    font-size: 10px;
    font-weight: 500;
  }

  &__text {
    font-size: 13px;
    color: $color-text-primary;
    margin: 0;
    word-break: break-word;
  }
}

.chat-pinned {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba($color-accent, 0.1);
  border-top: 1px solid rgba($color-accent, 0.2);
  color: $color-text-secondary;
  font-size: 12px;
  flex-shrink: 0;
}

.chat-input {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid $color-border;
  flex-shrink: 0;

  &__field {
    flex: 1;
    background: $color-bg-hover;
    border: 1px solid $color-border;
    border-radius: 6px;
    padding: 6px 10px;
    color: $color-text-primary;
    font-size: 13px;
    outline: none;

    &::placeholder { color: $color-text-muted; }
    &:focus { border-color: $color-accent; }
  }

  &__send {
    padding: 6px 14px;
    background: $color-accent;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    &:hover { background: $color-accent-hover; }
  }
}

// CoStream
.panel-header__count {
  font-size: 12px;
  color: $color-text-muted;
  margin-left: auto;
}

.costream-section-label {
  padding: 6px 12px 2px;
  font-size: 11px;
  font-weight: 600;
  color: $color-text-muted;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.costream-apply-list {
  padding: 0 12px 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.costream-apply-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: rgba($color-accent, 0.08);
  border: 1px solid rgba($color-accent, 0.2);
  border-radius: 8px;

  .costream-item__name { flex: 1; font-size: 13px; color: $color-text-primary; }

  &__btn {
    padding: 3px 8px;
    border-radius: 4px;
    border: none;
    font-size: 12px;
    cursor: pointer;
    &--accept { background: $color-accent; color: #fff; &:hover { opacity: 0.85; } }
    &--reject { background: transparent; border: 1px solid $color-border; color: $color-text-secondary; &:hover { background: $color-bg-hover; } }
  }
}

.costream-item__role-tag {
  margin-left: 2px;
  color: $color-accent;
  font-size: 10px;
}

.costream-item__ctrl--kick {
  &:hover { color: $color-danger !important; border-color: $color-danger !important; }
}

.costream-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: $color-text-muted;
}

.costream-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  flex-shrink: 0;
}

.costream-btn {
  padding: 8px;
  border-radius: 6px;
  border: 1px solid $color-border;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;

  &--guest    { background: $color-accent; color: #fff; border-color: $color-accent; }
  &--danger   { background: $color-danger; color: #fff; border-color: $color-danger; }
  &--outline  { background: transparent; color: $color-text-secondary; }

  &:hover { opacity: 0.85; }
}

.costream-stats {
  display: flex;
  gap: 16px;
  padding: 0 12px 8px;
  font-size: 12px;
  color: $color-text-secondary;
  flex-shrink: 0;
}

.costream-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.costream-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: $color-bg-panel;
  border-radius: 8px;

  &__avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: $color-accent;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    flex-shrink: 0;
  }

  &__name {
    flex: 1;
    font-size: 13px;
    color: $color-text-primary;
    small { color: $color-text-muted; font-size: 11px; }
  }

  &__controls {
    display: flex;
    gap: 4px;
  }

  &__ctrl {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid $color-border;
    background: transparent;
    color: $color-text-secondary;
    cursor: pointer;
    &:hover { background: $color-bg-hover; }
    &.muted { color: $color-danger; border-color: $color-danger; }
  }
}

.costream-footer {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid $color-border;
  flex-shrink: 0;

  &__btn {
    flex: 1;
    padding: 7px;
    background: $color-bg-panel;
    border: 1px solid $color-border;
    border-radius: 6px;
    color: $color-text-primary;
    font-size: 12px;
    cursor: pointer;
    &:hover { background: $color-bg-hover; }
  }
}

// ─── Product Panel ─────────────────────────────────────────────────────────
.product-add-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: $color-accent;
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  &:hover { background: $color-accent-hover; }
}

.product-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.product-panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  color: $color-text-muted;
  font-size: 13px;
  text-align: center;
  p { margin: 0; }
}

.product-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: $color-bg-panel;
  border: 1px solid $color-border;
  border-radius: 8px;
  transition: border-color 0.15s;

  &--highlighted {
    border-color: $color-accent;
    background: rgba($color-accent, 0.06);
  }

  &__img {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    background: $color-bg-hover;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__info {
    flex: 1;
    min-width: 0;
  }

  &__name {
    font-size: 12px;
    color: $color-text-primary;
    margin: 0 0 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__price-row {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }

  &__price {
    font-size: 13px;
    font-weight: 700;
    color: #ef4444;
  }

  &__original {
    font-size: 11px;
    color: $color-text-muted;
    text-decoration: line-through;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  &__icon-row {
    display: flex;
    gap: 2px;
  }

  &__highlight-btn {
    padding: 3px 7px;
    border-radius: 4px;
    border: 1px solid $color-border;
    background: transparent;
    color: $color-text-secondary;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;

    &.active {
      background: $color-accent;
      color: #fff;
      border-color: $color-accent;
    }

    &:not(.active):hover {
      border-color: $color-accent;
      color: $color-accent;
    }
  }

  &__icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: $color-text-muted;
    cursor: pointer;
    &:hover { background: $color-bg-hover; color: $color-text-primary; }

    &--del:hover { color: #ef4444 !important; }
  }
}

.product-form {
  padding: 0 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;

  &--panel {
    padding: 8px 12px 10px;
    border-bottom: 1px solid $color-border;
    background: rgba($color-accent, 0.04);
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: $color-text-primary;
    margin-bottom: 2px;
  }

  &__row {
    display: flex;
    gap: 6px;
  }

  &__input {
    flex: 1;
    background: $color-bg-hover;
    border: 1px solid $color-border;
    border-radius: 6px;
    padding: 6px 8px;
    color: $color-text-primary;
    font-size: 12px;
    outline: none;
    min-width: 0;

    &::placeholder { color: $color-text-muted; }
    &:focus { border-color: $color-accent; }
  }

  &__preview {
    width: 100%;
    height: 80px;
    border-radius: 6px;
    overflow: hidden;
    background: $color-bg-panel;
    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  }

  &__actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 2px;
  }

  &__cancel {
    padding: 5px 12px;
    background: transparent;
    border: 1px solid $color-border;
    border-radius: 6px;
    color: $color-text-secondary;
    font-size: 12px;
    cursor: pointer;
    &:hover { background: $color-bg-hover; }
  }

  &__save {
    padding: 5px 12px;
    background: $color-accent;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    &:hover { background: $color-accent-hover; }
  }
}
</style>
