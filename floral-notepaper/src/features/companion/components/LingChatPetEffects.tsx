import { useMemo } from "react";

/**
 * LingChat 桌宠粒子特效（移植自 LingChat StarField / BAParticles）。
 * - starfield：星空点阵（随机位置闪烁的小圆点）
 * - ba：缓慢下落粒子
 */

const STAR_COUNT = 36;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/** 星空点阵：随机分布的星星，闪烁 */
export function StarField() {
  const stars = useMemo(
    () =>
      Array.from({ length: STAR_COUNT }, () => ({
        left: randomBetween(2, 98),
        top: randomBetween(2, 98),
        size: randomBetween(1.5, 4),
        delay: randomBetween(0, 3),
        duration: randomBetween(1.6, 3.4),
        opacity: randomBetween(0.4, 1),
      })),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {stars.map((star, index) => (
        <span
          key={index}
          className="absolute rounded-full bg-white"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            opacity: star.opacity,
            boxShadow: "0 0 6px rgba(255,255,255,0.9)",
            animation: `lc-starfield-fall ${star.duration}s ease-in-out ${star.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/** 下落粒子（对标 BAParticles：particle-count 60、speed 0.2） */
const BA_COUNT = 24;

export function BAParticles() {
  const particles = useMemo(
    () =>
      Array.from({ length: BA_COUNT }, () => ({
        left: randomBetween(0, 100),
        size: randomBetween(2, 6),
        delay: randomBetween(0, 4),
        duration: randomBetween(6, 11),
        color: ["rgba(34,211,238,0.55)", "rgba(255,255,255,0.5)", "rgba(167,139,250,0.5)"][
          Math.floor(randomBetween(0, 3))
        ],
      })),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {particles.map((p, index) => (
        <span
          key={index}
          className="absolute rounded-full"
          style={{
            left: `${p.left}%`,
            top: "-6%",
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            animation: `lc-starfield-fall ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/** 按 effect id 渲染对应粒子层 */
export function PetEffectLayer({ effect }: { effect: "none" | "starfield" | "ba" }) {
  if (effect === "starfield") return <StarField />;
  if (effect === "ba") return <BAParticles />;
  return null;
}
