import type { Canvas } from 'fabric';
import { IDENTITY_VIEWPORT } from './viewport';

/**
 * Toolbar не является родителем CanvasStage, поэтому активный canvas
 * передаётся через маленький реестр, а не через глобальный стор сцены.
 */
let activeCanvas: Canvas | null = null;

export function registerCanvas(canvas: Canvas): void {
  activeCanvas = canvas;
}

export function unregisterCanvas(canvas: Canvas): void {
  if (activeCanvas === canvas) activeCanvas = null;
}

export function getActiveCanvas(): Canvas | null {
  return activeCanvas;
}

export function resetViewport(): boolean {
  if (!activeCanvas) return false;
  activeCanvas.setViewportTransform(IDENTITY_VIEWPORT);
  activeCanvas.requestRenderAll();
  return true;
}
