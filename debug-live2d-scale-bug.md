# Debug Session: live2d-scale-bug

Status: [OPEN]

## Bug
Live2D 模型放大操作始终无法生效，需要从 Pixi 渲染画布、CSS 容器、resize / WebGL / Container scale 链路定位根因并修复。

## Constraints
- Steps 1-4 only collect evidence; no business logic fix before runtime evidence.
- First logical codebase change must be instrumentation only.
- Cleanup only after user confirms fixed or aborts.

## Hypotheses
1. Pixi Application / canvas 的 CSS 尺寸与 renderer 实际分辨率不一致，导致模型 scale 参数变化但视觉尺寸被布局抵消。
2. Live2D model 或父级 Pixi Container 在 resize / layout 同步后被重新计算 scale，覆盖了用户放大操作。
3. 父级 DOM 容器或 canvas 存在 overflow / max-size / fixed 边界裁剪，模型被放大但超出区域不可见。
4. transform-origin / CSS transform / GPU 合成层配置导致缩放中心或视觉合成异常，使放大看起来无效。
5. Pixi Container scale.set() 调用时机早于模型加载完成或被后续 fit / anchor / viewport 逻辑重置。

## Evidence Log

## Pre-fix Findings

## Fix

## Post-fix Verification

## Cleanup
