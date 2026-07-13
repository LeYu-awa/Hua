import * as PIXI from "pixi.js";
import { BlurFilter } from "pixi.js";
import type { Live2DScene } from "./scene";

export interface StageBackgroundController {
  setBackground: (src: string | null) => Promise<void>;
  setPosition: (x: number, y: number) => void;
  setScale: (scale: number) => void;
  setBlur: (strength: number) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

/**
 * 创建舞台背景控制器。
 * 管理 backgroundLayer 中的背景精灵（非 Live2D 模型仅背景图）。
 */
export function createStageBackgroundController(scene: Live2DScene): StageBackgroundController {
  // 背景精灵 (实际背景图片)
  let bgSprite: PIXI.Sprite | null = null;
  let blurFilter: BlurFilter | null = null;
  let currentSrc: string | null = null;
  let posX = 50;
  let posY = 50;
  let bgScale = 100;

  // 初始透明背景已在 scene.ts 中创建，这里在它之上叠加一个图片精灵
  const ensureBgSprite = () => {
    if (bgSprite) return bgSprite;
    bgSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    bgSprite.anchor.set(0.5, 0.5);
    bgSprite.width = scene.app.screen.width;
    bgSprite.height = scene.app.screen.height;
    bgSprite.alpha = 0;
    scene.backgroundLayer.addChild(bgSprite);
    return bgSprite;
  };

  return {
    async setBackground(src: string | null) {
      if (src === currentSrc) return;
      currentSrc = src;

      const sprite = ensureBgSprite();

      if (!src) {
        sprite.alpha = 0;
        sprite.texture = PIXI.Texture.WHITE;
        return;
      }

      try {
        const texture = await PIXI.Assets.load(src);
        sprite.texture = texture;
        sprite.alpha = 1;

        // 居中显示
        sprite.anchor.set(0.5, 0.5);
        const screenW = scene.app.screen.width;
        const screenH = scene.app.screen.height;
        const imgRatio = texture.width / texture.height;
        const screenRatio = screenW / screenH;

        if (imgRatio > screenRatio) {
          sprite.height = screenH;
          sprite.width = screenH * imgRatio;
        } else {
          sprite.width = screenW;
          sprite.height = screenW / imgRatio;
        }

        // 应用位置和缩放
        sprite.x = screenW * (posX / 100);
        sprite.y = screenH * (posY / 100);
        sprite.scale.set(sprite.scale.x * (bgScale / 100));
      } catch {
        // 图片加载失败，保持透明
        sprite.alpha = 0;
      }
    },

    setPosition(x: number, y: number) {
      posX = x;
      posY = y;
      if (bgSprite) {
        bgSprite.x = scene.app.screen.width * (x / 100);
        bgSprite.y = scene.app.screen.height * (y / 100);
      }
    },

    setScale(scale: number) {
      bgScale = scale;
      if (bgSprite) {
        const baseScale = bgSprite.scale.x / (bgScale / 100);
        bgSprite.scale.set(baseScale * (scale / 100));
      }
    },

    setBlur(strength: number) {
      if (!blurFilter) {
        blurFilter = new BlurFilter();
        if (bgSprite) {
          bgSprite.filters = [blurFilter];
        }
      }
      blurFilter.blur = strength;
    },

    setVisible(visible: boolean) {
      if (bgSprite) {
        bgSprite.alpha = visible ? 1 : 0;
      }
    },

    destroy() {
      if (bgSprite && bgSprite.parent) {
        bgSprite.parent.removeChild(bgSprite);
      }
      bgSprite?.destroy();
      bgSprite = null;
      blurFilter = null;
    },
  };
}
