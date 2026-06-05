import { ref, computed } from 'vue'
import { useRoomStore } from '@/stores/roomStore'
import type { CloudFile, CloudFileType } from '@/types/cloudDrive'

const PAGE_SIZE = 20

/** Raw record shape returned by /livesaas/ListVideoRoom */
interface VideoRoomRecord {
  videoRoomId: string
  videoName: string
  transcodingFileMp4Url: string
  fileKey?: string          // original file key; used as fallback URL when transcodingFileMp4Url is empty
  fileKeyTransTs?: string   // transcoded TS file key (not used currently, reserved for compatibility)
  videoCoverUrl: string
  videoDuration: string
  videoSize: string
  videoHeight: number
  videoWidth: number
  videoMediaType: string
  videoTransState: number
  verifyStatus: number
  createName: string
  createTime: string
}

interface ListVideoRoomResponse {
  code: number
  msg: string
  data: {
    totalCount: number
    records: VideoRoomRecord[]
  }
}

function mapRecord(r: VideoRoomRecord, sassUrl: string): CloudFile {
  // Prefer the transcoded MP4 URL; fall back to sassUrl + fileKey (original upload)
  // when transcoding hasn't finished or transcodingFileMp4Url is not yet populated.
  const downloadUrl = r.transcodingFileMp4Url || (r.fileKey ? `${sassUrl}/${r.fileKey}` : '')
  return {
    id:          r.videoRoomId,
    name:        r.videoName,
    type:        guessFileType(r.videoMediaType, r.videoName),
    downloadUrl,
    coverUrl:    r.videoCoverUrl,
    duration:    r.videoDuration ?? '',
    size:        r.videoSize ?? '',
    width:       r.videoWidth  ?? 0,
    height:      r.videoHeight ?? 0,
    mediaType:   r.videoMediaType ?? '',
    creatorName: r.createName ?? '',
    createTime:  r.createTime ?? '',
  }
}

function guessFileType(mimeType: string, name: string): CloudFileType {
  const mime = (mimeType ?? '').toLowerCase()
  const ext  = (name ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('video') || ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv'].includes(ext)) return 'video'
  if (mime.startsWith('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  return 'document'
}

export function useCloudDrive() {
  const roomStore = useRoomStore()

  const files      = ref<CloudFile[]>([])
  const total      = ref(0)
  const pageNum    = ref(1)
  const isLoading  = ref(false)
  const error      = ref<string | null>(null)
  const searchName = ref('')

  // AbortControllers for in-flight requests.
  // fetchFiles aborts both when starting a new search to prevent stale data.
  let fetchController:     AbortController | null = null
  let fetchMoreController: AbortController | null = null

  function buildHeaders(): HeadersInit {
    return {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${roomStore.token}`,
    }
  }

  /** Internal helper: POST a single page request and return parsed records + total. */
  async function fetchPage(
    page:       number,
    nameFilter: string,
    signal:     AbortSignal,
  ): Promise<{ records: CloudFile[]; totalCount: number }> {
    const body = {
      roomInfoId:      roomStore.room.id,
      videoName:       nameFilter || undefined,
      videoTransState: 2,   // transcoding succeeded
      verifyStatus:    1,   // verified
      originType:      1,   // uploaded video
      pageNum:         page,
      pageSize:        PAGE_SIZE,
    }

    const res = await fetch(`${roomStore.sassUrl}/livesaas/ListVideoRoom`, {
      method:  'POST',
      headers: buildHeaders(),
      body:    JSON.stringify(body),
      signal,
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json: ListVideoRoomResponse = await res.json()
    if (json.code !== 200) throw new Error(json.msg || '接口返回错误')

    return {
      records:    (json.data.records ?? []).map(r => mapRecord(r, roomStore.sassUrl)),
      totalCount: json.data.totalCount ?? 0,
    }
  }

  /**
   * Fetch the first page of video files (resets current list).
   * Cancels any in-flight request to prevent stale-response race conditions.
   */
  async function fetchFiles(nameFilter = '') {
    if (!roomStore.sassUrl || !roomStore.token) {
      error.value = '未配置云盘接口地址或登录令牌'
      return
    }

    // Cancel any in-flight requests (both search and load-more) to prevent
    // stale responses from overwriting results after a new search begins.
    fetchController?.abort()
    fetchMoreController?.abort()
    fetchController = new AbortController()
    const signal = fetchController.signal

    isLoading.value  = true
    error.value      = null
    searchName.value = nameFilter
    pageNum.value    = 1

    try {
      const { records, totalCount } = await fetchPage(1, nameFilter, signal)
      files.value = records
      total.value = totalCount
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return  // superseded by newer request
      error.value = err instanceof Error ? err.message : '获取云盘文件失败'
      files.value = []
      total.value = 0
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Append the next page to the current list (infinite scroll / load more).
   */
  async function fetchMore() {
    if (!roomStore.sassUrl || !roomStore.token) return
    if (files.value.length >= total.value) return
    if (isLoading.value) return

    isLoading.value      = true
    error.value          = null
    const nextPage       = pageNum.value + 1
    fetchMoreController  = new AbortController()
    const signal         = fetchMoreController.signal

    try {
      const { records, totalCount } = await fetchPage(nextPage, searchName.value, signal)
      files.value   = [...files.value, ...records]
      total.value   = totalCount
      pageNum.value = nextPage
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      error.value = err instanceof Error ? err.message : '加载更多失败'
    } finally {
      isLoading.value = false
    }
  }

  /** Reactive indicator: whether there are more pages to load */
  const hasMore = computed(() => files.value.length < total.value)

  return {
    files,
    total,
    pageNum,
    isLoading,
    error,
    searchName,
    fetchFiles,
    fetchMore,
    hasMore,
  }
}
