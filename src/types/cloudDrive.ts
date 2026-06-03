/** File type discriminator */
export type CloudFileType = 'video' | 'document' | 'image'

/** A single file record from the cloud drive API */
export interface CloudFile {
  /** videoRoomId from ListVideoRoom */
  id: string
  /** Display name */
  name: string
  type: CloudFileType
  /** URL for streaming/downloading the transcoded file */
  downloadUrl: string
  /** Thumbnail/cover image URL */
  coverUrl: string
  /** Duration string, e.g. "00:30:45" (videos only) */
  duration: string
  /** Human-readable file size, e.g. "123.45MB" */
  size: string
  /** Video dimensions (videos only) */
  width: number
  height: number
  /** MIME type, e.g. "video/mp4" */
  mediaType: string
  /** Creator name */
  creatorName: string
  /** ISO datetime string */
  createTime: string
}

/** Pagination wrapper returned by useCloudDrive */
export interface CloudFilePage {
  records: CloudFile[]
  total: number
  pageNum: number
  pageSize: number
}

/** Video insert playback mode */
export type VideoInsertMode = 'fullscreen' | 'pip'
