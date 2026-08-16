import type {
  BongocatActionState,
  CompanionAction,
  CompanionInputEvent,
  CompanionSensitivity,
  PawState,
} from "./types";

const INITIAL_STATE: BongocatActionState = {
  action: "idle",
  paw: "none",
  intensity: 0,
  lastEventAt: 0,
};

export class BongocatActionCore {
  private state: BongocatActionState = { ...INITIAL_STATE };
  private lastPaw: PawState = "right";
  private lastMotionAt = 0;

  constructor(private sensitivity: CompanionSensitivity) {}

  updateSensitivity(sensitivity: CompanionSensitivity) {
    this.sensitivity = sensitivity;
  }

  dispatch(event: CompanionInputEvent) {
    if (event.type === "show") {
      this.state = { action: "idle", paw: "none", intensity: 0, lastEventAt: event.timestamp };
      return this.state;
    }

    if (event.type === "hide") {
      this.state = { action: "hide", paw: "none", intensity: 0, lastEventAt: event.timestamp };
      return this.state;
    }

    if (event.type === "input") {
      if (event.timestamp - this.lastMotionAt < this.sensitivity.motionCooldownMs)
        return this.state;
      this.lastMotionAt = event.timestamp;
      const paw = this.nextTypingPaw();
      this.state = {
        action: "typing",
        paw,
        intensity: this.sensitivity.typingIntensity,
        lastEventAt: event.timestamp,
      };
      return this.state;
    }

    this.state = {
      action: mapEventToAction(event.type),
      paw: getPawForEvent(event.type),
      intensity: event.type === "complete" || event.type === "effect" ? 1 : 0.55,
      lastEventAt: event.timestamp,
    };
    return this.state;
  }

  tick(now: number) {
    if (this.state.action === "hide") return this.state;
    if (
      this.state.action !== "idle" &&
      now - this.state.lastEventAt >= this.sensitivity.idleTimeoutMs
    ) {
      this.state = { action: "idle", paw: "none", intensity: 0, lastEventAt: now };
    }
    return this.state;
  }

  getState() {
    return this.state;
  }

  private nextTypingPaw(): PawState {
    this.lastPaw = this.lastPaw === "left" ? "right" : "left";
    return this.lastPaw;
  }
}

function mapEventToAction(type: CompanionInputEvent["type"]): CompanionAction {
  switch (type) {
    case "delete":
      return "delete";
    case "save":
      return "save";
    case "complete":
      return "complete";
    case "effect":
      return "effect";
    case "moveLeft":
      return "moveLeft";
    case "moveRight":
      return "moveRight";
    case "moveUp":
      return "moveUp";
    case "moveDown":
      return "moveDown";
    case "pause":
      return "pause";
    default:
      return "idle";
  }
}

function getPawForEvent(type: CompanionInputEvent["type"]): PawState {
  if (type === "delete" || type === "effect" || type === "moveUp" || type === "moveDown")
    return "both";
  if (type === "moveLeft") return "left";
  if (type === "moveRight" || type === "save" || type === "complete") return "right";
  return "none";
}
