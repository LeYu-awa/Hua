import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState, type PointerEventHandler } from "react";
import {
  BUILT_IN_YUNO_ASSET_BASE,
  BUILT_IN_YUNO_GAMEPAD_BASE,
  BUILT_IN_YUNO_GAMEPAD_MODEL_PATH,
  BUILT_IN_YUNO_KEYBOARD_BASE,
  BUILT_IN_YUNO_KEYBOARD_MODEL_PATH,
  BUILT_IN_YUNO_MODEL_PATH,
  DEFAULT_COMPANION_CONFIG,
  getBuiltInYunoCarouselImages,
  loadCompanionActionState,
  loadCompanionConfig,
  normalizeCompanionAssetPath,
  saveCompanionPosition,
  subscribeCompanionActionState,
  subscribeCompanionConfig,
} from "../companionConfig";
import { useCompanionEvents } from "../useCompanionEvents";
import type { BongocatActionState, CompanionConfig } from "../types";

type CompanionSurface = "embedded" | "floating";
const CAROUSEL_CACHE_LIMIT = 10;
const decodedImages = new Map<string, true>();
const decodeQueue = new Set<string>();

export function BongoCompanionLayer({ surface = "embedded" }: { surface?: CompanionSurface }) {
  const [config, setConfig] = useState<CompanionConfig>(() => loadCompanionConfig());

  useEffect(() => subscribeCompanionConfig(setConfig), []);

  if (config.renderer === "live2d") return null;
  if (surface === "floating") return <FloatingBongoCompanionLayer />;
  return <EmbeddedBongoCompanionLayer />;
}

function EmbeddedBongoCompanionLayer() {
  const [config, setConfig] = useState<CompanionConfig>(() => loadCompanionConfig());
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
  } | null>(null);
  const state = useCompanionEvents(config);
  const latestPositionRef = useRef(config.position);

  useEffect(
    () =>
      subscribeCompanionConfig((next) =>
        setConfig((current) => ({
          ...next,
          position: dragStart ? current.position : next.position,
        })),
      ),
    [dragStart],
  );
  useEffect(() => {
    latestPositionRef.current = config.position;
  }, [config.position]);

  useEffect(() => {
    if (!dragStart) return;

    const handlePointerMove = (event: PointerEvent) => {
      const nextX = dragStart.originX + event.clientX - dragStart.x;
      const nextY = dragStart.originY + event.clientY - dragStart.y;
      const maxX = Math.max(8, window.innerWidth - dragStart.width - 8);
      const maxY = Math.max(8, window.innerHeight - dragStart.height - 8);
      const position = {
        x: clamp(nextX, 8, maxX),
        y: clamp(nextY, 8, maxY),
      };

      latestPositionRef.current = position;
      setConfig((current) => ({ ...current, position }));
    };

    const handlePointerUp = () => {
      const next = saveCompanionPosition(latestPositionRef.current);
      setConfig(next);
      setDragStart(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragStart]);

  if (!config.enabled || config.mode !== "embedded" || !config.visible || state.action === "hide")
    return null;

  return (
    <BongoCompanionFigure
      config={config}
      state={state}
      surface="embedded"
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragStart({
          x: event.clientX,
          y: event.clientY,
          originX: config.position.x,
          originY: config.position.y,
          width: rect.width,
          height: rect.height,
        });
      }}
    />
  );
}

function FloatingBongoCompanionLayer() {
  const [config, setConfig] = useState<CompanionConfig>(() => loadCompanionConfig());
  const [state, setState] = useState<BongocatActionState>(() => loadCompanionActionState());

  useEffect(() => subscribeCompanionConfig(setConfig), []);
  useEffect(() => subscribeCompanionActionState(setState), []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        if (disposed) return;
        const currentWindow = getCurrentWindow();
        unlisten = await currentWindow.onMoved(({ payload }) => {
          saveCompanionPosition({ x: payload.x, y: payload.y });
        });
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (config.renderer === "live2d") return null;
  if (!config.enabled || config.mode !== "floating" || !config.visible || state.action === "hide")
    return null;

  return (
    <BongoCompanionFigure
      config={config}
      state={state}
      surface="floating"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    />
  );
}

function BongoCompanionFigure({
  config,
  state,
  surface,
  onPointerDown,
}: {
  config: CompanionConfig;
  state: BongocatActionState;
  surface: CompanionSurface;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
}) {
  if (isBuiltInYunoSprite(config)) {
    return (
      <YunoSpriteCompanionFigure
        config={config}
        state={state}
        surface={surface}
        onPointerDown={onPointerDown}
      />
    );
  }

  const motionLabel = getMotionLabel(config, state);

  return (
    <aside
      className={`bongo-companion-layer bongo-surface-${surface}`}
      style={{
        transform:
          surface === "embedded"
            ? `translate(${config.position.x}px, ${config.position.y}px) scale(${config.scale})`
            : `scale(${config.scale})`,
        opacity: config.opacity,
      }}
      aria-label="Bongocat 写作陪伴"
    >
      <div
        className={`bongo-companion-card action-${state.action} paw-${state.paw}`}
        onPointerDown={onPointerDown}
      >
        <div className="bongo-companion-glow" />
        <div className="bongo-companion-ear left" />
        <div className="bongo-companion-ear right" />
        <div className="bongo-companion-face">
          <span className="bongo-eye left" />
          <span className="bongo-eye right" />
          <span className="bongo-mouth" />
        </div>
        <div className="bongo-keyboard">
          <span />
          <span />
          <span />
        </div>
        <div className="bongo-paw left" />
        <div className="bongo-paw right" />
        <div className="bongo-motion-tag">{motionLabel}</div>
      </div>
    </aside>
  );
}

function YunoSpriteCompanionFigure({
  config,
  state,
  surface,
  onPointerDown,
}: {
  config: CompanionConfig;
  state: BongocatActionState;
  surface: CompanionSurface;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
}) {
  const motionLabel = getMotionLabel(config, state);
  const frames = useYunoKeyboardFrames(state);
  const standardHandFrame = useYunoStandardHandFrame(state);
  const assetBase = getYunoSpriteAssetBase(config);
  const carouselImage = useCompanionCarouselImage(config, assetBase);

  if (config.inputMode === "standard") {
    const standardCarouselImage =
      carouselImage &&
      !carouselImage.includes("/standard/hand/") &&
      carouselImage !== `${assetBase}/cat.png`
        ? carouselImage
        : null;

    return (
      <aside
        className={`bongo-companion-layer bongo-surface-${surface} yuno-companion-layer`}
        style={{
          transform:
            surface === "embedded"
              ? `translate(${config.position.x}px, ${config.position.y}px) scale(${config.scale})`
              : `scale(${config.scale})`,
          opacity: config.opacity,
        }}
        aria-label="尤诺 Bongocat 写作陪伴"
      >
        <div
          className={`yuno-companion-card action-${state.action} paw-${state.paw}`}
          onPointerDown={onPointerDown}
        >
          <CompanionImage
            src={`${assetBase}/cat.png`}
            className="yuno-companion-frame yuno-cat-frame"
            eager
          />
          <CompanionImage
            src={`${assetBase}/mousebg.png`}
            className="yuno-companion-frame yuno-standard-base-frame"
            eager
          />
          {standardCarouselImage ? (
            <CompanionImage
              src={standardCarouselImage}
              className="yuno-companion-frame yuno-carousel-frame"
            />
          ) : null}
          <CompanionImage
            src={`${assetBase}/hand/${standardHandFrame}.png`}
            className="yuno-companion-frame yuno-standard-hand-frame"
            eager
          />
          <div className="bongo-motion-tag">{motionLabel}</div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`bongo-companion-layer bongo-surface-${surface} yuno-companion-layer`}
      style={{
        transform:
          surface === "embedded"
            ? `translate(${config.position.x}px, ${config.position.y}px) scale(${config.scale})`
            : `scale(${config.scale})`,
        opacity: config.opacity,
      }}
      aria-label="尤诺 Bongocat 写作陪伴"
    >
      <div
        className={`yuno-companion-card action-${state.action} paw-${state.paw}`}
        onPointerDown={onPointerDown}
      >
        <CompanionImage
          src={`${assetBase}/cat.png`}
          className="yuno-companion-frame yuno-cat-frame"
          eager
        />
        {carouselImage && carouselImage !== `${assetBase}/cat.png` ? (
          <CompanionImage
            src={carouselImage}
            className="yuno-companion-frame yuno-carousel-frame"
          />
        ) : null}
        <CompanionImage
          src={`${assetBase}/bg.png`}
          className="yuno-companion-frame yuno-keyboard-frame"
          eager
        />
        <CompanionImage
          src={`${assetBase}/lefthand/${frames.left}.png`}
          className="yuno-companion-frame yuno-hand-frame"
          eager
        />
        <CompanionImage
          src={`${assetBase}/righthand/${frames.right}.png`}
          className="yuno-companion-frame yuno-hand-frame"
          eager
        />
        <div className="bongo-motion-tag">{motionLabel}</div>
      </div>
    </aside>
  );
}

function CompanionImage({
  src,
  className,
  eager = false,
}: {
  src: string;
  className: string;
  eager?: boolean;
}) {
  const resolvedSrc = useResolvedImageSrc(src);
  return (
    <img
      src={resolvedSrc}
      alt=""
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={className}
    />
  );
}

function getMotionLabel(config: CompanionConfig, state: BongocatActionState) {
  switch (state.action) {
    case "typing":
      if (state.paw === "left") return config.motionMap.typingLeft;
      if (state.paw === "right") return config.motionMap.typingRight;
      return config.motionMap.typingBoth;
    case "pause":
      return config.motionMap.pause;
    case "delete":
      return config.motionMap.delete;
    case "save":
      return config.motionMap.save;
    case "complete":
      return config.motionMap.complete;
    case "effect":
      return "effect";
    case "moveLeft":
      return "move_left";
    case "moveRight":
      return "move_right";
    case "moveUp":
      return "move_up";
    case "moveDown":
      return "move_down";
    case "hide":
      return config.motionMap.hidden;
    case "idle":
    default:
      return config.motionMap.idle ?? DEFAULT_COMPANION_CONFIG.motionMap.idle;
  }
}

function useYunoKeyboardFrames(state: BongocatActionState) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
    if (state.action === "idle" || state.action === "pause" || state.action === "hide") return;

    const interval = window.setInterval(
      () => setStep((current) => (current + 1) % 4),
      state.action === "typing" ? 90 : 140,
    );
    return () => window.clearInterval(interval);
  }, [state.action, state.paw, state.lastEventAt]);

  return getYunoKeyboardFrames(state, step);
}

function getYunoKeyboardFrames(state: BongocatActionState, step = 0) {
  const tap = [1, 2, 1, 0];
  const strongTap = [2, 1, 2, 0];
  const confirmTap = [3, 2, 3, 0];

  if (state.action === "typing") {
    const frame = tap[step % tap.length];
    if (state.paw === "left") return { left: frame, right: 0 };
    if (state.paw === "right") return { left: 0, right: frame };
    return { left: frame, right: frame };
  }
  if (state.action === "delete" || state.action === "effect") {
    const frame = strongTap[step % strongTap.length];
    return { left: frame, right: frame };
  }
  if (state.action === "moveLeft") return { left: strongTap[step % strongTap.length], right: 0 };
  if (state.action === "moveRight") return { left: 0, right: strongTap[step % strongTap.length] };
  if (state.action === "moveUp") return { left: "leftup", right: "rightup" };
  if (state.action === "moveDown") {
    const frame = tap[step % tap.length];
    return { left: frame, right: frame };
  }
  if (state.action === "save") return { left: 0, right: confirmTap[step % confirmTap.length] };
  if (state.action === "complete")
    return { left: tap[step % tap.length], right: confirmTap[step % confirmTap.length] };
  return { left: 0, right: 0 };
}

function useYunoStandardHandFrame(state: BongocatActionState) {
  const [step, setStep] = useState(0);
  const sequence = useMemo(() => getYunoStandardHandSequence(state), [state.action, state.paw]);

  useEffect(() => {
    setStep(0);
    if (state.action === "idle" || state.action === "pause" || state.action === "hide") return;

    const interval = window.setInterval(
      () => setStep((current) => (current + 1) % sequence.length),
      state.action === "typing" ? 70 : 110,
    );
    return () => window.clearInterval(interval);
  }, [sequence.length, state.action, state.lastEventAt]);

  return sequence[step % sequence.length] ?? 0;
}

function getYunoStandardHandSequence(state: BongocatActionState) {
  if (state.action === "typing") {
    if (state.paw === "left") return range(1, 29);
    if (state.paw === "right") return range(30, 59);
    return range(1, 89);
  }
  if (state.action === "delete" || state.action === "effect") return range(60, 79);
  if (state.action === "moveLeft") return range(30, 44);
  if (state.action === "moveRight") return range(45, 59);
  if (state.action === "moveUp" || state.action === "save" || state.action === "complete")
    return range(80, 89);
  if (state.action === "moveDown") return range(70, 79);
  return [0];
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function getYunoSpriteAssetBase(config: CompanionConfig) {
  if (config.inputMode === "standard") return BUILT_IN_YUNO_ASSET_BASE;
  if (config.inputMode === "gamepad") return BUILT_IN_YUNO_GAMEPAD_BASE;
  return BUILT_IN_YUNO_KEYBOARD_BASE;
}

function useCompanionCarouselImage(config: CompanionConfig, assetBase: string) {
  const images = useMemo(
    () => getRenderableCarouselImages(config.carousel.images, assetBase, config.inputMode),
    [assetBase, config.carousel.images, config.inputMode],
  );
  const [index, setIndex] = useState(() =>
    clamp(config.carousel.currentIndex, 0, Math.max(images.length - 1, 0)),
  );

  useEffect(() => {
    setIndex((current) => clamp(current, 0, Math.max(images.length - 1, 0)));
  }, [images.length]);

  useEffect(() => {
    if (!config.carousel.enabled || images.length <= 1) return;
    const interval = window.setInterval(
      () => {
        setIndex((current) => getNextCarouselIndex(current, images.length, config.carousel.order));
      },
      Math.max(600, config.carousel.intervalMs),
    );
    return () => window.clearInterval(interval);
  }, [config.carousel.enabled, config.carousel.intervalMs, config.carousel.order, images.length]);

  const currentImage = images[index] ?? images[0];
  useCarouselImagePreload(images, index, config.carousel.enabled);
  return currentImage;
}

function getRenderableCarouselImages(
  images: string[],
  _assetBase: string,
  inputMode: CompanionConfig["inputMode"],
) {
  const source = images.length > 0 ? images : getBuiltInYunoCarouselImages(inputMode);
  const normalized = source
    .map(normalizeCompanionAssetPath)
    .filter(isRenderableImageAsset)
    .map((image) => normalizeCarouselImageForMode(image, _assetBase));

  return Array.from(new Set(normalized));
}

function normalizeCarouselImageForMode(image: string, _assetBase: string) {
  return image;
}

function isRenderableImageAsset(image: string) {
  if (!image) return false;
  if (image.startsWith("data:") || image.startsWith("blob:")) return true;
  if (image.includes("/cat_model/") || image.endsWith(".model3.json") || image.endsWith(".json"))
    return false;
  return /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(image);
}

function useCarouselImagePreload(images: string[], currentIndex: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled || images.length <= 1) return;
    const preloadIndexes = [
      currentIndex,
      (currentIndex + 1) % images.length,
      (currentIndex + 2) % images.length,
    ];
    const idle =
      window.requestIdleCallback ??
      ((callback: IdleRequestCallback) =>
        window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    const idleId = idle(() => {
      preloadIndexes.forEach((imageIndex) => preloadDecodedImage(images[imageIndex]));
    });

    return () => cancelIdle(idleId);
  }, [currentIndex, enabled, images]);
}

function preloadDecodedImage(src: string | undefined) {
  if (!src || decodedImages.has(src) || decodeQueue.has(src)) return;
  decodeQueue.add(src);
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    decodeQueue.delete(src);
    decodedImages.set(src, true);
    trimImageDecodeCache();
  };
  image.onerror = () => decodeQueue.delete(src);
  image.src = resolveImageSrc(src);
}

function trimImageDecodeCache() {
  while (decodedImages.size > CAROUSEL_CACHE_LIMIT) {
    const oldest = decodedImages.keys().next().value;
    if (!oldest) break;
    decodedImages.delete(oldest);
  }
}

function useResolvedImageSrc(src: string) {
  return useMemo(() => resolveImageSrc(src), [src]);
}

function resolveImageSrc(src: string) {
  if (!src || src.startsWith("/") || /^(https?|file|tauri|asset|data|blob):/i.test(src)) return src;
  return convertFileSrc(src);
}

function isBuiltInYunoSprite(config: CompanionConfig) {
  if (config.skinId === "haru-cdn") return false;
  return (
    config.skinId === "a-yuno-keyboard" ||
    config.skinId === "a-yuno-gamepad" ||
    config.skinId === "a-yuno-standard" ||
    (config.renderer === "live2d" &&
      (config.modelPath === BUILT_IN_YUNO_MODEL_PATH ||
        config.modelPath === BUILT_IN_YUNO_KEYBOARD_MODEL_PATH ||
        config.modelPath === BUILT_IN_YUNO_GAMEPAD_MODEL_PATH))
  );
}

function getNextCarouselIndex(
  current: number,
  length: number,
  order: CompanionConfig["carousel"]["order"],
) {
  if (length <= 1) return 0;
  if (order === "reverse") return (current - 1 + length) % length;
  if (order === "random") {
    const next = Math.floor(Math.random() * length);
    return next === current ? (next + 1) % length : next;
  }
  return (current + 1) % length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
