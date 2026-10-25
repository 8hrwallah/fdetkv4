const ORDER_STORAGE_KEY = "snorlaxAppShortcuts";
const DRAG_THRESHOLD = 6;
const EDGE_SCROLL_SIZE = 28;
const EDGE_SCROLL_SPEED = 180;
const MOTION_SPEED = 36;
const ARROW_PLAYBACK_RATE = 4;
const SHORTCUT_STEP = 80;

export const APP_SHORTCUTS = [
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com/", icon: "/assets/img/youtube.png" },
  { id: "geforce-now", name: "GeForce NOW", url: "https://play.geforcenow.com/", icon: "/assets/img/geforce.png" },
  { id: "discord", name: "Discord", url: "https://discord.com/login", icon: "/assets/img/discord.jpg" },
  { id: "tiktok", name: "TikTok", url: "https://www.tiktok.com/", icon: "/assets/img/tiktok.png" },
  { id: "duckduckgo", name: "DuckDuckGo", url: "https://duckduckgo.com/", icon: "https://duckduckgo.com/favicon.ico" },
  { id: "azgames", name: "Azgames.io", url: "https://azgames.io/", icon: "https://azgames.io/favicon.ico" },
];

export function getShortcutOrder(savedValue, items = APP_SHORTCUTS) {
  let savedIds = [];
  try {
    const parsed = JSON.parse(savedValue);
    if (Array.isArray(parsed)) savedIds = parsed;
  } catch {
    savedIds = [];
  }

  const available = new Set(items.map((item) => item.id));
  const saved = savedIds
    .map((id) => id === "slope" && available.has("tiktok") ? "tiktok" : id)
    .filter((id) => typeof id === "string" && available.has(id));
  return [...new Set([...saved, ...items.map((item) => item.id)])];
}

export function moveShortcut(order, id, targetIndex) {
  const currentIndex = order.indexOf(id);
  if (currentIndex < 0 || !Number.isInteger(targetIndex)) return [...order];
  const next = [...order];
  next.splice(currentIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, id);
  return next;
}

export function advanceRightwardScroll(scrollLeft, elapsedMs, loopWidth, speed = MOTION_SPEED) {
  if (loopWidth <= 0) return 0;
  const position = scrollLeft - Math.max(0, elapsedMs) * speed / 1000;
  return ((position % loopWidth) + loopWidth) % loopWidth;
}

export function preserveLoopPhase(scrollLeft, previousWidth, nextWidth) {
  if (previousWidth <= 0 || nextWidth <= 0) return nextWidth;
  const phase = ((scrollLeft % previousWidth) + previousWidth) % previousWidth;
  return phase / previousWidth * nextWidth;
}

export function getMarqueeRepetitions(viewportWidth, sequenceWidth) {
  if (sequenceWidth <= 0) return 2;
  return Math.max(2, Math.ceil((Math.max(0, viewportWidth) + sequenceWidth) / sequenceWidth));
}

function reorderFromPointer(group, draggedButton, clientX) {
  const siblings = [...group.querySelectorAll(".app-shortcut:not([data-visual-clone='true'])")]
    .filter((button) => button !== draggedButton);
  const target = siblings.find((button) => clientX < button.getBoundingClientRect().left + button.getBoundingClientRect().width / 2);
  if (target) {
    if (draggedButton.nextElementSibling !== target) group.insertBefore(draggedButton, target);
  } else if (draggedButton.nextElementSibling) {
    group.append(draggedButton);
  }
}

export function mountAppShortcuts() {
  if (typeof document === "undefined") return;
  const viewport = document.getElementById("app-shortcuts-list");
  const section = document.getElementById("app-shortcuts");
  const previousArrow = section?.querySelector(".app-shortcuts-arrow--previous");
  const nextArrow = section?.querySelector(".app-shortcuts-arrow--next");
  const defaults = [...APP_SHORTCUTS];
  const items = defaults;
  const itemById = new Map(items.map((item) => [item.id, item]));

  if (!viewport || !section || !previousArrow || !nextArrow) return;

  let savedValue = null;
  try {
    savedValue = localStorage.getItem(ORDER_STORAGE_KEY);
  } catch (error) {
    console.warn("Shortcut preferences are unavailable:", error);
  }
  let order = getShortcutOrder(savedValue, items);
  let groups = [];
  let loopWidth = 0;
  let dragState = null;
  let dragFrame = 0;
  let pointerX = 0;
  let sequenceRepetitions = 0;
  let arrowResetTimer = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const saveOrder = (nextOrder) => {
    order = nextOrder;
    try {
      localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
    } catch (error) {
      console.warn("Could not save shortcut order:", error);
    }
  };

  const makeButton = (item, visualClone = false) => {
    const button = document.createElement("button");
    button.className = "app-shortcut";
    button.type = "button";
    button.dataset.shortcutId = item.id;
    button.setAttribute("aria-label", item.name);
    button.setAttribute("aria-grabbed", "false");
    button.draggable = false;
    button.tabIndex = visualClone ? -1 : 0;

    if (visualClone) {
      button.dataset.visualClone = "true";
      button.setAttribute("aria-hidden", "true");
    }

    if (item.icon) {
      const image = document.createElement("img");
      image.src = item.icon;
      image.alt = "";
      image.draggable = false;
      image.addEventListener("error", () => image.remove(), { once: true });
      button.append(image);
    }

    if (!visualClone) {
      button.addEventListener("click", (event) => {
        if (button.dataset.suppressClick === "true") {
          event.preventDefault();
          event.stopImmediatePropagation();
          delete button.dataset.suppressClick;
          return;
        }
        window.openLink(item.url);
      });
      button.addEventListener("keydown", (event) => handleKeyboardMove(event, button, item));
    }

    button.addEventListener("pointerdown", (event) => {
      if (visualClone || !event.isPrimary || event.button !== 0) return;
      const group = button.closest(".app-shortcuts-group");
      dragState = {
        button,
        group,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      button.setAttribute("aria-grabbed", "true");
    });

    return button;
  };

  const handleKeyboardMove = (event, button, item) => {
    if (event.key === " " && button.getAttribute("aria-grabbed") !== "true") {
      event.preventDefault();
      button.setAttribute("aria-grabbed", "true");
      return;
    }
    if (button.getAttribute("aria-grabbed") !== "true") return;
    if (event.key === "Escape" || event.key === " " || event.key === "Enter") {
      event.preventDefault();
      button.setAttribute("aria-grabbed", "false");
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const currentIndex = order.indexOf(item.id);
    const nextIndex = Math.max(0, Math.min(order.length - 1, currentIndex + (event.key === "ArrowLeft" ? -1 : 1)));
    if (nextIndex === currentIndex) return;
    const next = moveShortcut(order, item.id, nextIndex);
    saveOrder(next);
    renderGroups();
    const movedButton = groups[1].querySelector(`[data-shortcut-id="${CSS.escape(item.id)}"]`);
    movedButton?.focus();
    movedButton?.setAttribute("aria-grabbed", "true");
  };

  function renderGroups(scrollToMain = false) {
    const focusedId = viewport.contains(document.activeElement)
      ? document.activeElement.dataset.shortcutId
      : null;
    const previousTrack = viewport.firstElementChild;
    const previousAnimation = previousTrack?.getAnimations()[0];
    const previousDuration = previousAnimation?.effect?.getTiming().duration;
    const previousTime = previousAnimation?.currentTime;
    const previousPhase = typeof previousDuration === "number" && previousDuration > 0
      && typeof previousTime === "number"
      ? (previousTime % previousDuration) / previousDuration
      : 0;
    const previousWidth = loopWidth;
    const track = document.createElement("div");
    track.className = "app-shortcuts-track";
    const orderedItems = order.map((id) => itemById.get(id)).filter(Boolean);
    groups = [];

    sequenceRepetitions = getMarqueeRepetitions(viewport.clientWidth, items.length * SHORTCUT_STEP);
    for (let groupIndex = 0; groupIndex < 2; groupIndex += 1) {
      const group = document.createElement("div");
      group.className = "app-shortcuts-group";
      if (groupIndex === 0) {
        group.setAttribute("role", "list");
        group.setAttribute("aria-label", "App shortcuts");
      } else {
        group.setAttribute("aria-hidden", "true");
      }
      for (let repetition = 0; repetition < sequenceRepetitions; repetition += 1) {
        for (const item of orderedItems) {
          group.append(makeButton(item, groupIndex !== 0 || repetition !== 0));
        }
      }
      groups.push(group);
      track.append(group);
    }

    viewport.replaceChildren(track);
    loopWidth = groups[0]?.getBoundingClientRect().width || 0;
    track.style.setProperty("--shortcut-loop-distance", `${loopWidth}px`);
    track.style.setProperty("--shortcut-loop-duration", `${loopWidth / MOTION_SPEED}s`);
    const animation = track.getAnimations()[0];
    if (animation && !scrollToMain && typeof animation.effect?.getTiming().duration === "number") {
      animation.currentTime = previousPhase * Number(animation.effect.getTiming().duration);
    }
    if (focusedId) {
      const focusedButton = groups[0].querySelector(`[data-shortcut-id="${CSS.escape(focusedId)}"]`);
      focusedButton?.focus();
    }
    if (previousWidth !== loopWidth) resetArrowMotion();
  }

  const getTrackAnimation = () => viewport.firstElementChild?.getAnimations()[0];

  const resetArrowMotion = () => {
    const animation = getTrackAnimation();
    if (animation) animation.updatePlaybackRate(1);
    section.dataset.accelerating = "";
    if (arrowResetTimer) window.clearTimeout(arrowResetTimer);
    arrowResetTimer = 0;
  };

  const pauseMotion = () => {
    viewport.classList.add("is-paused");
  };

  const resumeMotion = () => {
    viewport.classList.remove("is-paused");
  };

  const moveWithArrow = (direction, held) => {
    if (reducedMotion.matches) {
      viewport.scrollBy({
        left: (direction === "left" ? -1 : 1) * SHORTCUT_STEP,
        behavior: "instant",
      });
      return;
    }
    const animation = getTrackAnimation();
    if (!animation) return;
    const rate = direction === "left" ? ARROW_PLAYBACK_RATE : -ARROW_PLAYBACK_RATE;
    animation.updatePlaybackRate(held ? rate : 1);
    section.dataset.accelerating = held ? direction : "";
  };

  const bindArrow = (button, direction) => {
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (arrowResetTimer) window.clearTimeout(arrowResetTimer);
      arrowResetTimer = 0;
      moveWithArrow(direction, true);
    });
    for (const eventName of ["pointerup", "pointercancel", "pointerleave", "blur"]) {
      button.addEventListener(eventName, () => moveWithArrow(direction, false));
    }
    button.addEventListener("click", (event) => {
      if (event.detail !== 0) return;
      if (reducedMotion.matches) {
        moveWithArrow(direction, false);
        return;
      }
      moveWithArrow(direction, true);
      arrowResetTimer = window.setTimeout(resetArrowMotion, 550);
    });
  };

  const autoScrollDuringDrag = () => {
    if (!dragState?.moved) {
      dragFrame = 0;
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    let direction = 0;
    if (pointerX < bounds.left + EDGE_SCROLL_SIZE) direction = -1;
    else if (pointerX > bounds.right - EDGE_SCROLL_SIZE) direction = 1;
    if (direction) {
      viewport.scrollLeft += direction * EDGE_SCROLL_SPEED / 60;
      reorderFromPointer(dragState.group, dragState.button, pointerX);
    }
    dragFrame = requestAnimationFrame(autoScrollDuringDrag);
  };

  document.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    pointerX = event.clientX;
    if (!dragState.moved && Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) < DRAG_THRESHOLD) return;
    dragState.moved = true;
    event.preventDefault();
    pauseMotion();
    reorderFromPointer(dragState.group, dragState.button, event.clientX);
    if (!dragFrame) dragFrame = requestAnimationFrame(autoScrollDuringDrag);
  }, { passive: false });

  document.addEventListener("pointerup", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const { button, group, moved } = dragState;
    dragState = null;
    if (dragFrame) cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    if (moved) {
      const next = [...group.querySelectorAll(".app-shortcut:not([data-visual-clone='true'])")]
        .map((entry) => entry.dataset.shortcutId);
      button.dataset.suppressClick = "true";
      saveOrder(next);
      renderGroups();
      window.setTimeout(() => delete button.dataset.suppressClick, 0);
    } else {
      button.setAttribute("aria-grabbed", "false");
    }
    resumeMotion();
  });

  document.addEventListener("pointercancel", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState.button.setAttribute("aria-grabbed", "false");
    dragState = null;
    if (dragFrame) cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    resumeMotion();
  });

  viewport.addEventListener("focusin", pauseMotion);
  viewport.addEventListener("focusout", () => window.setTimeout(resumeMotion, 0));
  reducedMotion.addEventListener("change", resetArrowMotion);
  document.addEventListener("visibilitychange", () => {
    viewport.classList.toggle("is-hidden", document.hidden);
  });
  bindArrow(previousArrow, "left");
  bindArrow(nextArrow, "right");

  renderGroups(true);
  resumeMotion();
  const resizeObserver = new ResizeObserver(() => {
    const nextRepetitions = getMarqueeRepetitions(viewport.clientWidth, items.length * SHORTCUT_STEP);
    if (nextRepetitions !== sequenceRepetitions) renderGroups();
  });
  resizeObserver.observe(viewport);
}

mountAppShortcuts();
