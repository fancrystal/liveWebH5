import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CoStreamParticipant } from '@/types/costream'

export const useCoStreamStore = defineStore('coStream', () => {
  const participants = ref<Map<string, CoStreamParticipant>>(new Map())
  const isGuestMicOpen = ref(false)
  const isAudienceMicOpen = ref(false)
  const applyList = ref<CoStreamParticipant[]>([])

  const participantList = computed(() => Array.from(participants.value.values()))
  const participantCount = computed(() => participants.value.size)
  const applyCount = computed(() => applyList.value.length)

  function addParticipant(p: CoStreamParticipant) {
    participants.value.set(p.id, p)
  }

  function removeParticipant(id: string) {
    participants.value.delete(id)
    applyList.value = applyList.value.filter(p => p.id !== id)
  }

  function updateParticipant(id: string, partial: Partial<CoStreamParticipant>) {
    const p = participants.value.get(id)
    if (p) participants.value.set(id, { ...p, ...partial })
  }

  function addApply(p: CoStreamParticipant) {
    if (!applyList.value.find(a => a.id === p.id)) applyList.value.push(p)
  }

  function removeApply(id: string) {
    applyList.value = applyList.value.filter(p => p.id !== id)
  }

  function clearAll() {
    participants.value.clear()
    applyList.value = []
  }

  function muteAll() {
    participants.value.forEach((p, id) => {
      if (p.role !== 'host') updateParticipant(id, { audioEnabled: false })
    })
  }

  function unmuteAll() {
    participants.value.forEach((p, id) => {
      if (p.role !== 'host') updateParticipant(id, { audioEnabled: true })
    })
  }

  const isCoStreaming = ref(false)

  return {
    participants, isGuestMicOpen, isAudienceMicOpen, applyList,
    participantList, participantCount, applyCount, isCoStreaming,
    addParticipant, removeParticipant, updateParticipant, clearAll,
    addApply, removeApply, muteAll, unmuteAll,
  }
})
