export type WhiteboardTool =
  | 'select'
  | 'pen'
  | 'text'
  | 'rect'
  | 'laser'
  | 'eraser'

export interface WhiteboardPage {
  id: string
  name: string
  fabricJson?: object  // serialized fabric.Canvas state
}

export interface ToolOptions {
  color: string
  strokeWidth: number
  fontSize: number
  fontFamily: string
  eraserSize: number
}
