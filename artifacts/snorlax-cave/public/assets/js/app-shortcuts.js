const ORDER_STORAGE_KEY = "snorlaxAppShortcuts";
const DRAG_THRESHOLD = 6;
const EDGE_SCROLL_SIZE = 28;
const EDGE_SCROLL_SPEED = 180;
const MOTION_SPEED = 18;

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

function reorderFromPointer(group, draggedButton, clientX) {
  const siblings = [...group.querySelectorAll(".app-shortcut")].filter((button) => button !== draggedButton);
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
  const defaults = [...APP_SHORTCUTS];
  const items = defaults;
  const itemById = new Map(items.map((item) => [item.id, item]));

  if (!viewport) return;

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
  let animationFrame = 0;
  let dragFrame = 0;
  let previousFrame = 0;
  let pointerX = 0;
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
    } else {
      button.setAttribute("aria-hidden", "true");
      button.addEventListener("click", () => window.openLink(item.url));
    }

    button.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
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
    const previousWidth = loopWidth;
    const previousPosition = viewport.scrollLeft;
    const track = document.createElement("div");
    track.className = "app-shortcuts-track";
    const orderedItems = order.map((id) => itemById.get(id)).filter(Boolean);
    groups = [];

    for (let groupIndex = 0; groupIndex < 3; groupIndex += 1) {
      const group = document.createElement("div");
      group.className = "app-shortcuts-group";
      group.setAttribute("role", "list");
      group.setAttribute("aria-label", groupIndex === 1 ? "App shortcuts" : "");
      const clone = groupIndex !== 1;
      if (clone) {
        group.setAttribute("aria-hidden", "true");
      }
      for (const item of orderedItems) group.append(makeButton(item, clone));
      groups.push(group);
      track.append(group);
    }

    viewport.replaceChildren(track);
    loopWidth = groups[0]?.getBoundingClientRect().width || 0;
    viewport.scrollLeft = scrollToMain
      ? loopWidth
      : preserveLoopPhase(previousPosition, previousWidth, loopWidth);
  }

  const pauseMotion = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previousFrame = 0;
  };

  const animate = (time) => {
    animationFrame = 0;
    if (reducedMotion.matches || dragState || viewport.contains(document.activeElement) || loopWidth <= 0) return;
    if (previousFrame) {
      const elapsed = time - previousFrame;
      viewport.scrollLeft = advanceRightwardScroll(viewport.scrollLeft, elapsed, loopWidth);
    }
    previousFrame = time;
    animationFrame = requestAnimationFrame(animate);
  };

  const resumeMotion = () => {
    if (reducedMotion.matches || dragState || viewport.contains(document.activeElement) || animationFrame) return;
    previousFrame = 0;
    animationFrame = requestAnimationFrame(animate);
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
      const next = [...group.querySelectorAll(".app-shortcut")].map((entry) => entry.dataset.shortcutId);
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
  viewport.addEventListener("wheel", () => {
    if (dragState) return;
    pauseMotion();
    window.setTimeout(resumeMotion, 1200);
  }, { passive: true });
  reducedMotion.addEventListener("change", () => reducedMotion.matches ? pauseMotion() : resumeMotion());
  document.addEventListener("visibilitychange", () => document.hidden ? pauseMotion() : resumeMotion());
  window.addEventListener("resize", () => {
    const previousWidth = loopWidth;
    loopWidth = groups[0]?.getBoundingClientRect().width || 0;
    if (previousWidth && loopWidth) {
      viewport.scrollLeft = preserveLoopPhase(viewport.scrollLeft, previousWidth, loopWidth);
    }
  });

  renderGroups(true);
  resumeMotion();
}

mountAppShortcuts();
