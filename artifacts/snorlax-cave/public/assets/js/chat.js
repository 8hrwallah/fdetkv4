(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const apiRoot = "/api/chat";
  const avatarFaces = ["🐱", "🦊", "🦉", "🐸", "🐻", "🐢"];
  const avatarBackgrounds = [
    "linear-gradient(145deg,#56a9a3,#235c63)",
    "linear-gradient(145deg,#e7a146,#97492f)",
    "linear-gradient(145deg,#7771dc,#393d86)",
    "linear-gradient(145deg,#81c84b,#307b46)",
    "linear-gradient(145deg,#d9827b,#713a65)",
    "linear-gradient(145deg,#35c8ca,#176a7c)",
  ];
  const emojiOptions = ["😀", "😂", "🥹", "😍", "😎", "🤔", "🙌", "👋", "💚", "✨", "🔥", "🌲", "🍄", "🐾", "🏕️", "🦊", "🐸", "🎮"];
  const allowedTypes = new Set([
    "image/png", "image/jpeg", "image/gif", "image/webp",
    "application/pdf", "text/plain", "text/csv", "text/markdown",
    "audio/webm", "video/webm", "audio/ogg", "audio/mp4", "audio/m4a",
  ]);
  const state = {
    user: null,
    channels: [],
    channelId: "general",
    messages: [],
    unread: new Map(),
    replyTo: null,
    pendingFile: null,
    uploadXhr: null,
    eventSource: null,
    recorder: null,
    recorderStream: null,
    recordingChunks: [],
    recordingBlob: null,
    recordingDuration: 0,
    recordingStartedAt: 0,
    recordingTimer: null,
    toastTimer: null,
    newMessages: 0,
    lastTypingAt: 0,
    oldestCursor: "",
    loadingOlder: false,
    collapsedOffline: false,
    searchText: "",
  };

  const elements = {
    frame: $(".chat-frame"),
    channels: $("#channel-list"),
    channelName: $("#current-channel-name"),
    channelDescription: $("#current-channel-description"),
    messages: $("#messages-list"),
    messagesWrap: $("#messages-wrap"),
    historyLoader: $("#history-loader"),
    onlineCount: $("#online-count"),
    toolbarCount: $("#toolbar-online-count"),
    onlineMembers: $("#online-members"),
    offlineMembers: $("#offline-members"),
    offlineCount: $("#offline-count"),
    roomNotice: $("#room-notice"),
    roomNoticeText: $("#room-notice-text"),
    sidebarNotice: $("#sidebar-notice"),
    joinOverlay: $("#join-overlay"),
    joinForm: $("#join-form"),
    joinUsername: $("#join-username"),
    joinError: $("#join-error"),
    ownerSetupSecret: $("#owner-setup-secret"),
    messageInput: $("#message-input"),
    composer: $("#composer-form"),
    searchStrip: $("#search-strip"),
    messageSearch: $("#message-search"),
    searchToggle: $("#search-toggle"),
    replyPreview: $("#reply-preview"),
    uploadPreview: $("#upload-preview"),
    recordingBar: $("#recording-bar"),
    recordingPreview: $("#recording-preview"),
    typingNote: $("#typing-note"),
    toast: $("#chat-toast"),
    profileMenu: $("#profile-menu"),
    profileName: $("#profile-name"),
    profileAvatar: $("#profile-avatar"),
    connection: $("#connection-state"),
    emojiPicker: $("#emoji-picker"),
    newMessagePill: $("#new-message-pill"),
  };

  async function api(path, options = {}) {
    const response = await fetch(`${apiRoot}${path}`, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers || {}),
      },
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The chat server could not complete that request.");
    return payload;
  }

  async function send(method, path, body) {
    return api(path, { method, body: JSON.stringify(body ?? {}) });
  }

  function showToast(message, duration = 2800) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), duration);
  }

  function setConnection(status, label) {
    elements.connection.classList.remove("is-online", "is-offline");
    if (status === "online") elements.connection.classList.add("is-online");
    if (status === "offline") elements.connection.classList.add("is-offline");
    elements.connection.lastElementChild.textContent = label;
  }

  function initials(name) {
    return (name || "?").trim().slice(0, 1).toLocaleUpperCase();
  }

  function avatarIndex(member) {
    return Number.isInteger(Number(member.avatarIndex)) ? Number(member.avatarIndex) % avatarFaces.length : 0;
  }

  function makeAvatar(member, small = false, offline = false) {
    const index = avatarIndex(member);
    const avatar = document.createElement("span");
    avatar.className = `avatar${small ? " avatar-small" : ""}${offline ? " is-offline" : ""}`;
    avatar.style.background = avatarBackgrounds[index];
    avatar.textContent = avatarFaces[index] || initials(member.displayName || member.username);
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  function formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function roleLabel(role) {
    return ({ owner: "Owner", admin: "Admin", moderator: "Moderator", member: "Member" })[role] || "Member";
  }

  function makeLinkifiedText(text) {
    const fragment = document.createDocumentFragment();
    const matcher = /https?:\/\/[^\s<]+/gi;
    let start = 0;
    for (const match of text.matchAll(matcher)) {
      const index = match.index ?? 0;
      fragment.append(document.createTextNode(text.slice(start, index)));
      const link = document.createElement("a");
      link.href = match[0].replace(/[),.!?]+$/, "");
      link.textContent = link.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      fragment.append(link);
      if (link.href.length !== match[0].length) {
        fragment.append(document.createTextNode(match[0].slice(link.href.length)));
      }
      start = index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(start)));
    return fragment;
  }

  function iconUse(symbol) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${symbol}`);
    svg.append(use);
    return svg;
  }

  function addTextMessage(container, text, className = "message-text") {
    const paragraph = document.createElement("div");
    paragraph.className = className;
    paragraph.append(makeLinkifiedText(text || ""));
    container.append(paragraph);
    return paragraph;
  }

  function createAttachment(message) {
    const url = `${apiRoot}/files/${encodeURIComponent(message.attachmentId)}`;
    if ((message.mimeType || "").startsWith("image/")) {
      const image = document.createElement("img");
      image.className = "message-attachment-image";
      image.src = url;
      image.alt = message.fileName || "Shared image";
      image.loading = "lazy";
      image.addEventListener("click", () => {
        $("#lightbox-image").src = url;
        $("#lightbox").hidden = false;
      });
      return image;
    }
    if ((message.mimeType || "").startsWith("audio/")) {
      return createVoicePlayer(message, url);
    }
    const anchor = document.createElement("a");
    anchor.className = "message-attachment";
    anchor.href = url;
    anchor.download = message.fileName || "chat-attachment";
    const iconBox = document.createElement("span");
    iconBox.className = "attachment-icon";
    iconBox.append(iconUse("image"));
    const info = document.createElement("span");
    info.className = "attachment-info";
    const fileName = document.createElement("strong");
    fileName.textContent = message.fileName || "Attachment";
    const fileSize = document.createElement("small");
    fileSize.textContent = formatBytes(message.sizeBytes);
    info.append(fileName, fileSize);
    anchor.append(iconBox, info, iconUse("download"));
    return anchor;
  }

  function createVoicePlayer(message, url) {
    const player = document.createElement("div");
    player.className = "voice-player";
    const audio = document.createElement("audio");
    audio.className = "voice-audio";
    audio.preload = "none";
    audio.src = url;
    const play = document.createElement("button");
    play.type = "button";
    play.className = "voice-play";
    play.setAttribute("aria-label", "Play voice message");
    play.append(iconUse("play"));
    const wave = document.createElement("div");
    wave.className = "voice-wave";
    wave.setAttribute("role", "slider");
    wave.setAttribute("aria-label", "Voice message playback position");
    wave.tabIndex = 0;
    const seed = (message.id || "cave").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    for (let i = 0; i < 28; i += 1) {
      const bar = document.createElement("i");
      bar.style.height = `${5 + ((seed * (i + 3) + i * 13) % 16)}px`;
      wave.append(bar);
    }
    const duration = document.createElement("span");
    duration.className = "voice-duration";
    duration.textContent = message.durationSeconds ? `0:${String(message.durationSeconds).padStart(2, "0")}` : "0:00";
    player.append(audio, play, wave, duration);
    play.addEventListener("click", async () => {
      if (audio.paused) {
        try {
          await audio.play();
        } catch {
          showToast("This voice message could not be played.");
        }
      } else {
        audio.pause();
      }
    });
    audio.addEventListener("play", () => {
      play.replaceChildren(iconUse("pause"));
      play.setAttribute("aria-label", "Pause voice message");
    });
    audio.addEventListener("pause", () => {
      play.replaceChildren(iconUse("play"));
      play.setAttribute("aria-label", "Play voice message");
    });
    audio.addEventListener("timeupdate", () => {
      const ratio = audio.duration ? audio.currentTime / audio.duration : 0;
      wave.style.background = `linear-gradient(90deg, rgba(228,255,248,.9) ${ratio * 100}%, transparent ${ratio * 100}%)`;
      if (audio.duration && !message.durationSeconds) {
        duration.textContent = `0:${String(Math.ceil(audio.duration - audio.currentTime)).padStart(2, "0")}`;
      }
    });
    audio.addEventListener("ended", () => {
      audio.currentTime = 0;
      wave.style.background = "";
    });
    wave.addEventListener("click", (event) => {
      if (!audio.duration) return;
      const bounds = wave.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * audio.duration;
    });
    wave.addEventListener("keydown", (event) => {
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && audio.duration) {
        event.preventDefault();
        audio.currentTime += event.key === "ArrowRight" ? 5 : -5;
      }
    });
    audio.addEventListener("error", () => showToast("This voice message is unavailable."));
    return player;
  }

  function findMessage(messageId) {
    return state.messages.find((item) => item.id === messageId);
  }

  function createMessage(message) {
    const row = document.createElement("article");
    row.className = "chat-message";
    row.dataset.messageId = message.id;
    row.dataset.channelId = message.channelId;
    row.append(makeAvatar({ displayName: message.username, avatarIndex: message.avatarIndex }));

    const content = document.createElement("div");
    content.className = "message-content";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const author = document.createElement("span");
    author.className = "message-author";
    author.textContent = message.username || "Cave member";
    meta.append(author);
    if (message.role && message.role !== "member") {
      const badge = document.createElement("span");
      badge.className = `role-badge ${message.role}`;
      badge.textContent = roleLabel(message.role);
      meta.append(badge);
    }
    const time = document.createElement("time");
    time.className = "message-time";
    time.dateTime = message.createdAt;
    time.textContent = formatTime(message.createdAt);
    meta.append(time);
    if (message.editedAt) {
      const edited = document.createElement("span");
      edited.className = "message-edited";
      edited.textContent = "(edited)";
      meta.append(edited);
    }
    content.append(meta);

    if (message.replyToId) {
      const original = findMessage(message.replyToId);
      const quote = document.createElement("div");
      quote.className = "message-reply-quote";
      quote.textContent = original
        ? `${original.username}: ${original.content || original.fileName || "Attachment"}`
        : "Reply to an earlier message";
      content.append(quote);
    }
    if (message.content) addTextMessage(content, message.content);
    if (message.attachmentId) content.append(createAttachment(message));
    if (message.pinned) {
      const pinned = document.createElement("span");
      pinned.className = "message-pinned-label";
      pinned.append(iconUse("pin"), document.createTextNode("Pinned"));
      content.append(pinned);
    }

    const actions = document.createElement("div");
    actions.className = "message-actions";
    const addAction = (label, action, adminOnly = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.messageAction = action;
      if (adminOnly) button.dataset.adminOnly = "true";
      actions.append(button);
    };
    addAction("Reply", "reply");
    addAction("Copy", "copy");
    if (state.user?.id === message.senderId) addAction("Edit", "edit");
    addAction("Delete", "delete");
    addAction("Pin", "pin", true);
    addAction("Report", "report");
    content.append(actions);
    row.append(content);
    return row;
  }

  function renderMessages({ keepPosition = false } = {}) {
    const wasAtBottom = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < 80;
    elements.messages.replaceChildren();
    if (!state.messages.length) {
      const empty = document.createElement("div");
      empty.className = "empty-messages";
      const heading = document.createElement("strong");
      heading.textContent = state.searchText ? "No messages found" : "The cave is quiet… for now";
      const detail = document.createElement("span");
      detail.textContent = state.searchText
        ? "Try a different word or clear your search."
        : `Start things off in #${state.channelId}. Your first message belongs here.`;
      empty.append(heading, detail);
      elements.messages.append(empty);
      state.oldestCursor = "";
      return;
    }
    if (state.messages.length >= 60 && !state.searchText) {
      const older = document.createElement("button");
      older.type = "button";
      older.className = "quiet-button load-older";
      older.textContent = "Load older messages";
      older.addEventListener("click", loadOlderMessages);
      elements.messages.append(older);
    }
    for (const message of state.messages) elements.messages.append(createMessage(message));
    state.oldestCursor = state.messages[0]?.createdAt || "";
    if (!keepPosition && wasAtBottom) {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }
  }

  function renderChannels() {
    elements.channels.replaceChildren();
    for (const channel of state.channels) {
      const link = document.createElement("a");
      link.href = "#";
      link.className = `channel-link${channel.id === state.channelId ? " active" : ""}`;
      link.dataset.channelId = channel.id;
      link.setAttribute("aria-current", channel.id === state.channelId ? "page" : "false");
      link.append(iconUse(channel.icon === "mic" ? "mic" : channel.icon === "sparkles" ? "chat" : "hash"));
      const label = document.createElement("span");
      label.textContent = channel.label;
      link.append(label);
      const unread = state.unread.get(channel.id) || 0;
      if (unread && channel.id !== state.channelId) {
        const badge = document.createElement("span");
        badge.className = "channel-unread";
        badge.textContent = unread > 99 ? "99+" : String(unread);
        link.append(badge);
      }
      elements.channels.append(link);
    }
    const active = state.channels.find((channel) => channel.id === state.channelId);
    if (active) {
      elements.channelName.textContent = active.label;
      elements.channelDescription.textContent = active.description || "A quiet corner of the cave.";
    }
  }

  function renderMemberList() {
    const search = ($("#member-search").value || "").trim().toLocaleLowerCase();
    const online = state.members?.filter((member) => member.online && member.displayName.toLocaleLowerCase().includes(search)) || [];
    const offline = state.members?.filter((member) => !member.online && member.displayName.toLocaleLowerCase().includes(search)) || [];
    elements.onlineMembers.replaceChildren();
    elements.offlineMembers.replaceChildren();
    for (const member of online) elements.onlineMembers.append(createMemberRow(member, false));
    for (const member of offline) elements.offlineMembers.append(createMemberRow(member, true));
    elements.offlineCount.textContent = String(offline.length);
    elements.onlineCount.textContent = String(online.length);
    elements.toolbarCount.textContent = `${online.length} online`;
  }

  function createMemberRow(member, offline) {
    const row = document.createElement("div");
    row.className = "member-row";
    row.append(makeAvatar(member, false, offline));
    const copy = document.createElement("span");
    copy.className = "member-copy";
    const name = document.createElement("strong");
    name.textContent = member.displayName;
    const role = document.createElement("small");
    role.className = "member-role";
    role.textContent = roleLabel(member.role);
    copy.append(name, role);
    row.append(copy);
    if (state.user && ["owner", "admin", "moderator"].includes(state.user.role) &&
        member.id !== state.user.id && member.role !== "owner") {
      const menu = document.createElement("button");
      menu.type = "button";
      menu.className = "member-menu";
      menu.textContent = "⋯";
      menu.setAttribute("aria-label", `Moderate ${member.displayName}`);
      menu.addEventListener("click", () => moderateMember(member));
      row.append(menu);
    }
    return row;
  }

  function updateAdminVisibility() {
    const role = state.user?.role;
    const isAdmin = role === "owner" || role === "admin";
    for (const item of $$(".admin-only")) item.hidden = !isAdmin;
    $("#server-tools").hidden = !isAdmin;
    $("#audit-button").hidden = role !== "owner" && role !== "admin";
  }

  async function loadChannels() {
    const data = await api("/channels");
    state.channels = data.channels || [];
    if (!state.channels.some((channel) => channel.id === state.channelId)) {
      state.channelId = state.channels[0]?.id || "general";
    }
    renderChannels();
  }

  async function loadMessages({ before = "", keepPosition = false } = {}) {
    elements.historyLoader.hidden = true;
    if (!before) {
      elements.historyLoader.hidden = false;
      state.messages = [];
    }
    const query = new URLSearchParams({ channel: state.channelId });
    if (before) query.set("before", before);
    if (state.searchText) query.set("search", state.searchText);
    try {
      const data = await api(`/messages?${query.toString()}`);
      const loaded = data.messages || [];
      if (before) {
        const oldHeight = elements.messages.scrollHeight;
        state.messages = [...loaded, ...state.messages.filter((item) => !loaded.some((newItem) => newItem.id === item.id))];
        renderMessages({ keepPosition: true });
        elements.messages.scrollTop += elements.messages.scrollHeight - oldHeight;
      } else {
        state.messages = loaded;
        renderMessages({ keepPosition });
        elements.messages.scrollTop = elements.messages.scrollHeight;
      }
      updatePinnedStrip();
    } catch (error) {
      showToast(error.message);
      if (!before) {
        elements.messages.innerHTML = "";
        const empty = document.createElement("div");
        empty.className = "empty-messages";
        empty.textContent = "Messages could not be loaded. Check your connection and try again.";
        elements.messages.append(empty);
      }
    } finally {
      elements.historyLoader.hidden = true;
    }
  }

  async function loadOlderMessages() {
    if (state.loadingOlder || !state.oldestCursor) return;
    state.loadingOlder = true;
    await loadMessages({ before: state.oldestCursor, keepPosition: true });
    state.loadingOlder = false;
  }

  function updatePinnedStrip() {
    const pinned = state.messages.filter((message) => message.pinned);
    const strip = $("#pinned-strip");
    strip.hidden = !pinned.length;
    strip.replaceChildren();
    if (pinned.length) {
      strip.append(iconUse("pin"));
      const text = document.createElement("span");
      text.textContent = `${pinned.length} pinned message${pinned.length === 1 ? "" : "s"} in this channel`;
      strip.append(text);
    }
  }

  async function loadMembers() {
    try {
      const data = await api("/members");
      state.members = data.members || [];
      renderMemberList();
    } catch {
      state.members = state.members || [];
      renderMemberList();
    }
  }

  async function loadNotice() {
    try {
      const data = await api("/notice");
      const text = data.notice || "";
      $("#sidebar-notice").textContent = text || "Keep it friendly and follow the rules!";
      elements.roomNotice.hidden = !text;
      $("#room-notice-text").textContent = text;
    } catch {
      // The starter notice remains visible in the sidebar while offline.
    }
  }

  function openJoin() {
    elements.joinOverlay.hidden = false;
    setTimeout(() => elements.joinUsername.focus(), 40);
  }

  function closeJoin() {
    elements.joinOverlay.hidden = true;
    $("#profile-button").setAttribute("aria-label", `Profile for ${state.user.displayName}`);
    elements.profileName.textContent = state.user.displayName;
    elements.profileAvatar.textContent = avatarFaces[avatarIndex(state.user)];
    elements.profileAvatar.style.background = avatarBackgrounds[avatarIndex(state.user)];
    elements.messageInput.disabled = false;
    elements.messageInput.placeholder = `Message #${state.channelId}`;
    for (const id of ["emoji-toggle", "attach-button", "record-button"]) $(`#${id}`).disabled = false;
    $("#send-button").disabled = false;
    updateAdminVisibility();
  }

  async function joinChat(event) {
    event.preventDefault();
    elements.joinError.textContent = "";
    const username = elements.joinUsername.value.trim();
    const ownerSetupSecret = elements.ownerSetupSecret.value;
    const submit = $(".join-submit", elements.joinForm);
    submit.disabled = true;
    try {
      const data = await send("POST", "/join", { username, ownerSetupSecret });
      state.user = data.user;
      elements.ownerSetupSecret.value = "";
      closeJoin();
      setConnection("online", "Connected");
      await Promise.all([loadChannels(), loadMembers(), loadNotice()]);
      connectEvents();
      await loadMessages();
      startHeartbeat();
      showToast(`Welcome to the cave, ${state.user.displayName}!`);
    } catch (error) {
      elements.joinError.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  async function startSession() {
    try {
      await loadChannels();
      const data = await api("/session");
      state.user = data.user;
      closeJoin();
      setConnection("online", "Connected");
      await Promise.all([loadMessages(), loadMembers(), loadNotice()]);
      connectEvents();
      startHeartbeat();
    } catch (error) {
      setConnection(error.message.includes("temporarily") ? "offline" : "offline",
        error.message.includes("temporarily") ? "Unavailable" : "Join to chat");
      openJoin();
    }
  }

  function connectEvents() {
    state.eventSource?.close();
    state.eventSource = new EventSource(`${apiRoot}/events`);
    state.eventSource.onopen = () => setConnection("online", "Connected");
    state.eventSource.onerror = () => setConnection("offline", "Reconnecting…");
    state.eventSource.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "ready") {
        setConnection("online", "Connected");
      } else if (data.type === "message") {
        const message = data.message;
        if (!message) return;
        if (message.channelId !== state.channelId) {
          state.unread.set(message.channelId, (state.unread.get(message.channelId) || 0) + 1);
          renderChannels();
          return;
        }
        if (state.messages.some((item) => item.id === message.id)) return;
        const atBottom = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < 80;
        state.messages.push(message);
        const row = createMessage(message);
        elements.messages.append(row);
        if (atBottom) {
          elements.messages.scrollTop = elements.messages.scrollHeight;
          state.newMessages = 0;
          elements.newMessagePill.hidden = true;
        } else {
          state.newMessages += 1;
          elements.newMessagePill.hidden = false;
          elements.newMessagePill.textContent = `${state.newMessages} new message${state.newMessages === 1 ? "" : "s"} ↓`;
        }
        updatePinnedStrip();
      } else if (data.type === "message:update") {
        const index = state.messages.findIndex((item) => item.id === data.message.id);
        if (index !== -1) state.messages[index] = data.message;
        renderMessages({ keepPosition: true });
      } else if (data.type === "message:delete") {
        state.messages = state.messages.filter((item) => item.id !== data.id);
        renderMessages({ keepPosition: true });
        updatePinnedStrip();
      } else if (data.type === "message:pin" && data.channelId === state.channelId) {
        const message = state.messages.find((item) => item.id === data.id);
        if (message) message.pinned = data.pinned;
        renderMessages({ keepPosition: true });
        updatePinnedStrip();
      } else if (data.type === "members") {
        loadMembers();
      } else if (data.type === "channels") {
        loadChannels();
      } else if (data.type === "notice") {
        $("#sidebar-notice").textContent = data.text || "Keep it friendly and follow the rules!";
        elements.roomNotice.hidden = !data.text;
        $("#room-notice-text").textContent = data.text || "";
      } else if (data.type === "typing" && data.channelId === state.channelId && data.memberId !== state.user?.id) {
        elements.typingNote.textContent = `${data.displayName} is typing…`;
        clearTimeout(state.typingTimer);
        state.typingTimer = setTimeout(() => { elements.typingNote.textContent = ""; }, 2200);
      }
    };
  }

  function startHeartbeat() {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = setInterval(() => {
      api("/heartbeat", { method: "POST", body: "{}" }).catch(() => setConnection("offline", "Reconnecting…"));
      loadMembers();
    }, 20_000);
  }

  async function postTyping() {
    if (!state.user || Date.now() - state.lastTypingAt < 1800) return;
    state.lastTypingAt = Date.now();
    try {
      await send("POST", "/typing", { channelId: state.channelId });
    } catch {
      // Typing events are best-effort and do not block composing.
    }
  }

  async function switchChannel(id) {
    if (!state.channels.some((channel) => channel.id === id)) return;
    state.channelId = id;
    state.unread.delete(id);
    state.newMessages = 0;
    elements.newMessagePill.hidden = true;
    renderChannels();
    await loadMessages();
    elements.messageInput.placeholder = `Message #${id}`;
    elements.frame.classList.remove("channels-open", "members-open");
    if (window.innerWidth <= 650) $("#drawer-scrim").hidden = true;
  }

  async function uploadFile(file, durationSeconds = null) {
    if (!file || file.size > 8 * 1024 * 1024) throw new Error("Choose a file that is 8 MB or smaller.");
    const mime = (file.type || "").split(";")[0].trim().toLowerCase();
    if (!allowedTypes.has(mime)) throw new Error("This file type is not enabled for chat.");
    const progressLabel = $("#upload-preview span");
    if (progressLabel) progressLabel.textContent = "Uploading 0%";
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      state.uploadXhr = xhr;
      xhr.open("POST", `${apiRoot}/uploads`);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type", mime);
      xhr.setRequestHeader("X-Chat-File-Type", mime);
      xhr.setRequestHeader("X-Chat-File-Name", encodeURIComponent(file.name || "voice-note"));
      if (durationSeconds !== null) xhr.setRequestHeader("X-Chat-Duration", String(durationSeconds));
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && progressLabel) {
          progressLabel.textContent = `Uploading ${Math.round((event.loaded / event.total) * 100)}%`;
        }
      });
      xhr.addEventListener("load", () => {
        state.uploadXhr = null;
        let payload = {};
        try { payload = JSON.parse(xhr.responseText); } catch { /* error below */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload.attachment);
        else reject(new Error(payload.error || "The upload failed."));
      });
      xhr.addEventListener("error", () => {
        state.uploadXhr = null;
        reject(new Error("The upload could not reach the chat server."));
      });
      xhr.addEventListener("abort", () => {
        state.uploadXhr = null;
        reject(new Error("Upload cancelled."));
      });
      xhr.send(file);
    });
  }

  async function sendMessage(event) {
    event?.preventDefault();
    if (!state.user) {
      openJoin();
      return;
    }
    const content = elements.messageInput.value.trim();
    if (!content && !state.pendingFile) return;
    const sendButton = $("#send-button");
    sendButton.disabled = true;
    try {
      let attachmentId = null;
      if (state.pendingFile) {
        const file = state.pendingFile;
        const attachment = await uploadFile(file);
        attachmentId = attachment.id;
        state.pendingFile = null;
        renderUploadPreview();
      }
      const data = await send("POST", "/messages", {
        content,
        channelId: state.channelId,
        attachmentId,
        replyToId: state.replyTo?.id || null,
      });
      if (data.message && !state.messages.some((item) => item.id === data.message.id)) {
        state.messages.push(data.message);
        renderMessages();
      }
      elements.messageInput.value = "";
      resizeComposer();
      clearReply();
    } catch (error) {
      showToast(error.message);
    } finally {
      sendButton.disabled = false;
      elements.messageInput.focus();
    }
  }

  function resizeComposer() {
    elements.messageInput.style.height = "auto";
    elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 110)}px`;
  }

  function renderUploadPreview() {
    elements.uploadPreview.replaceChildren();
    const file = state.pendingFile;
    elements.uploadPreview.hidden = !file;
    if (!file) return;
    if (file.type.startsWith("image/")) {
      const image = document.createElement("img");
      image.alt = "Selected attachment preview";
      image.src = URL.createObjectURL(file);
      elements.uploadPreview.append(image);
    }
    const name = document.createElement("span");
    name.textContent = `${file.name} · ${formatBytes(file.size)}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = state.uploadXhr ? "Cancel upload" : "Remove";
    remove.addEventListener("click", () => {
      if (state.uploadXhr) state.uploadXhr.abort();
      state.pendingFile = null;
      renderUploadPreview();
    });
    elements.uploadPreview.append(name, remove);
  }

  function stageFile(file) {
    if (!file) return;
    const mime = (file.type || "").toLowerCase();
    if (file.size > 8 * 1024 * 1024) {
      showToast("Files must be 8 MB or smaller.");
      return;
    }
    if (!allowedTypes.has(mime)) {
      showToast("That file type is not enabled for chat.");
      return;
    }
    state.pendingFile = file;
    renderUploadPreview();
  }

  function setReply(message) {
    state.replyTo = message;
    $("#reply-to-name").textContent = message.username;
    $("#reply-preview-text").textContent = message.content || message.fileName || "Attachment";
    elements.replyPreview.hidden = false;
    elements.messageInput.focus();
  }

  function clearReply() {
    state.replyTo = null;
    elements.replyPreview.hidden = true;
  }

  async function handleMessageAction(event) {
    const button = event.target.closest("[data-message-action]");
    if (!button) return;
    const row = button.closest("[data-message-id]");
    const message = findMessage(row?.dataset.messageId);
    if (!message) return;
    const action = button.dataset.messageAction;
    try {
      if (action === "reply") {
        setReply(message);
      } else if (action === "copy") {
        await navigator.clipboard.writeText(message.content || message.fileName || "");
        showToast("Message copied.");
      } else if (action === "edit") {
        const content = prompt("Edit your message", message.content || "");
        if (content === null) return;
        const data = await send("PATCH", `/messages/${encodeURIComponent(message.id)}`, { content });
        const index = state.messages.findIndex((item) => item.id === message.id);
        if (index >= 0) state.messages[index] = data.message;
        renderMessages({ keepPosition: true });
      } else if (action === "delete") {
        if (!confirm("Delete this message?")) return;
        await api(`/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" });
        state.messages = state.messages.filter((item) => item.id !== message.id);
        renderMessages({ keepPosition: true });
      } else if (action === "pin") {
        await send("POST", `/messages/${encodeURIComponent(message.id)}/pin`);
        await loadMessages({ keepPosition: true });
      } else if (action === "report") {
        const reason = prompt("Why are you reporting this message?", "Inappropriate message");
        if (reason === null) return;
        await send("POST", `/messages/${encodeURIComponent(message.id)}/report`, { reason });
        showToast("Report sent to the moderators.");
      }
    } catch (error) {
      showToast(error.message);
    }
  }

  async function moderateMember(member) {
    const options = state.user.role === "owner"
      ? ["Mute for 10 minutes", "Ban", "Change role", "Cancel"]
      : state.user.role === "admin"
        ? ["Mute for 10 minutes", "Ban", "Cancel"]
        : ["Mute for 10 minutes", "Cancel"];
    const selection = prompt(`Moderate ${member.displayName}:\n${options.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n\nEnter a number`);
    if (!selection || !/^[1-4]$/.test(selection)) return;
    const picked = options[Number(selection) - 1];
    try {
      if (picked === "Mute for 10 minutes") {
        await send("POST", `/members/${encodeURIComponent(member.id)}/moderate`, { action: "mute" });
      } else if (picked === "Ban") {
        await send("POST", `/members/${encodeURIComponent(member.id)}/moderate`, { action: "ban" });
      } else if (picked === "Change role") {
        const role = prompt("Choose member, moderator, or admin.", member.role);
        if (!["member", "moderator", "admin"].includes(role)) return;
        await send("POST", `/members/${encodeURIComponent(member.id)}/role`, { role });
      } else return;
      await loadMembers();
      showToast(`${picked} completed.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function recordVoice() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast("Voice recording is not supported in this browser.");
      return;
    }
    try {
      state.recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preference = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
      const mimeType = preference.find((type) => MediaRecorder.isTypeSupported(type));
      state.recorder = mimeType ? new MediaRecorder(state.recorderStream, { mimeType }) : new MediaRecorder(state.recorderStream);
      state.recordingChunks = [];
      state.recordingStartedAt = Date.now();
      state.recordingDuration = 0;
      state.recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) state.recordingChunks.push(event.data);
      });
      state.recorder.addEventListener("stop", finishRecording);
      state.recorder.start(250);
      elements.recordingBar.hidden = false;
      elements.recordingPreview.hidden = true;
      state.recordingTimer = setInterval(() => {
        state.recordingDuration = Math.floor((Date.now() - state.recordingStartedAt) / 1000);
        $("#recording-clock").textContent = `0:${String(state.recordingDuration).padStart(2, "0")}`;
        if (state.recordingDuration >= 180) stopRecording();
      }, 250);
    } catch {
      releaseMicrophone();
      showToast("Microphone access was not granted.");
    }
  }

  function finishRecording() {
    clearInterval(state.recordingTimer);
    state.recordingDuration = Math.min(180, Math.ceil((Date.now() - state.recordingStartedAt) / 1000));
    const type = state.recorder?.mimeType || "audio/webm";
    state.recordingBlob = new Blob(state.recordingChunks, { type });
    releaseMicrophone();
    elements.recordingBar.hidden = true;
    if (!state.recordingBlob.size) {
      elements.recordingPreview.hidden = true;
      showToast("No audio was captured. Try again.");
      return;
    }
    $("#recording-audio").src = URL.createObjectURL(state.recordingBlob);
    elements.recordingPreview.hidden = false;
  }

  function stopRecording() {
    if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  }

  function releaseMicrophone() {
    state.recorderStream?.getTracks().forEach((track) => track.stop());
    state.recorderStream = null;
    state.recorder = null;
  }

  function cancelRecording() {
    clearInterval(state.recordingTimer);
    if (state.recorder && state.recorder.state !== "inactive") {
      state.recorder.removeEventListener("stop", finishRecording);
      state.recorder.stop();
    }
    releaseMicrophone();
    state.recordingChunks = [];
    state.recordingBlob = null;
    elements.recordingBar.hidden = true;
    elements.recordingPreview.hidden = true;
  }

  async function sendRecording() {
    if (!state.recordingBlob) return;
    $("#send-recording").disabled = true;
    try {
      const ext = state.recordingBlob.type.includes("ogg") ? ".ogg"
        : state.recordingBlob.type.includes("mp4") ? ".m4a"
          : ".webm";
      const file = new File([state.recordingBlob], `cave-voice-note${ext}`, { type: state.recordingBlob.type });
      const attachment = await uploadFile(file, state.recordingDuration);
      const data = await send("POST", "/messages", {
        content: "",
        channelId: state.channelId,
        attachmentId: attachment.id,
        replyToId: state.replyTo?.id || null,
      });
      if (data.message && !state.messages.some((item) => item.id === data.message.id)) {
        state.messages.push(data.message);
        renderMessages();
      }
      state.recordingBlob = null;
      $("#recording-audio").removeAttribute("src");
      elements.recordingPreview.hidden = true;
      clearReply();
    } catch (error) {
      showToast(error.message);
    } finally {
      $("#send-recording").disabled = false;
    }
  }

  async function changeName() {
    const username = prompt("Choose a new display name (you can change it once per hour).", state.user.displayName);
    if (username === null) return;
    try {
      const data = await send("PATCH", "/profile", { username });
      state.user = data.user;
      closeJoin();
      await loadMembers();
      showToast("Your display name was updated.");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function leaveChat() {
    state.eventSource?.close();
    clearInterval(state.heartbeatTimer);
    try {
      await api("/leave", { method: "POST", body: "{}" });
    } catch {
      // Expired sessions are cleaned up after their heartbeat window.
    }
    state.user = null;
    elements.messageInput.disabled = true;
    elements.messageInput.placeholder = "Join the cave to send a message…";
    for (const id of ["emoji-toggle", "attach-button", "record-button", "send-button"]) $(`#${id}`).disabled = true;
    state.messages = [];
    renderMessages();
    elements.profileName.textContent = "Guest";
    elements.profileAvatar.textContent = "?";
    openJoin();
  }

  function toggleDrawer(which) {
    const isMobile = window.innerWidth <= 900;
    if (!isMobile) return;
    const channelMode = window.innerWidth <= 650;
    if (which === "channels" && channelMode) {
      elements.frame.classList.toggle("channels-open");
      elements.frame.classList.remove("members-open");
    } else {
      elements.frame.classList.toggle("members-open");
      elements.frame.classList.remove("channels-open");
    }
    $("#drawer-scrim").hidden = !elements.frame.classList.contains("channels-open") && !elements.frame.classList.contains("members-open");
  }

  async function setNotice() {
    const text = prompt("Set a shared room notice (leave empty to clear it).", $("#sidebar-notice").textContent || "");
    if (text === null) return;
    try {
      const data = await send("PUT", "/notice", { text });
      const notice = data.notice || "";
      $("#sidebar-notice").textContent = notice || "Keep it friendly and follow the rules!";
      elements.roomNotice.hidden = !notice;
      $("#room-notice-text").textContent = notice;
    } catch (error) {
      showToast(error.message);
    }
  }

  async function addChannel() {
    const label = prompt("Name the new cave channel (letters, numbers, or hyphens).");
    if (!label) return;
    try {
      const data = await send("POST", "/channels", { label });
      await loadChannels();
      await switchChannel(data.channel.id);
      showToast(`Created #${data.channel.label}.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function showAudit() {
    try {
      const data = await api("/audit");
      const lines = (data.events || []).slice(0, 12).map((event) =>
        `${formatTime(event.createdAt)} · ${event.actorName || "Former member"} · ${event.action}`,
      );
      alert(lines.join("\n") || "No moderation actions have been recorded yet.");
    } catch (error) {
      showToast(error.message);
    }
  }

  function populateEmojiPicker() {
    elements.emojiPicker.replaceChildren();
    for (const emoji of emojiOptions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = emoji;
      button.setAttribute("aria-label", `Insert ${emoji}`);
      button.addEventListener("click", () => {
        const input = elements.messageInput;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.setRangeText(emoji, start, end, "end");
        input.focus();
        resizeComposer();
        elements.emojiPicker.hidden = true;
      });
      elements.emojiPicker.append(button);
    }
  }

  function bindEvents() {
    elements.joinForm.addEventListener("submit", joinChat);
    elements.channels.addEventListener("click", (event) => {
      const link = event.target.closest("[data-channel-id]");
      if (!link) return;
      event.preventDefault();
      switchChannel(link.dataset.channelId);
    });
    elements.composer.addEventListener("submit", sendMessage);
    elements.messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendMessage(event);
      }
    });
    elements.messageInput.addEventListener("input", () => {
      resizeComposer();
      postTyping();
    });
    elements.messages.addEventListener("click", handleMessageAction);
    elements.messages.addEventListener("scroll", () => {
      const atBottom = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < 80;
      if (atBottom) {
        state.newMessages = 0;
        elements.newMessagePill.hidden = true;
      }
    });
    elements.newMessagePill.addEventListener("click", () => {
      elements.messages.scrollTop = elements.messages.scrollHeight;
      state.newMessages = 0;
      elements.newMessagePill.hidden = true;
    });
    elements.searchToggle.addEventListener("click", () => {
      elements.searchStrip.hidden = !elements.searchStrip.hidden;
      if (!elements.searchStrip.hidden) elements.messageSearch.focus();
      else {
        state.searchText = "";
        elements.messageSearch.value = "";
        loadMessages();
      }
    });
    elements.messageSearch.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.searchText = elements.messageSearch.value.trim();
        loadMessages();
      }, 260);
    });
    $("#clear-search").addEventListener("click", () => {
      elements.messageSearch.value = "";
      state.searchText = "";
      loadMessages();
      elements.messageSearch.focus();
    });
    $("#attach-button").addEventListener("click", () => $("#file-input").click());
    $("#file-input").addEventListener("change", (event) => {
      stageFile(event.target.files?.[0]);
      event.target.value = "";
    });
    elements.messagesWrap.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.messagesWrap.classList.add("drop-ready");
    });
    elements.messagesWrap.addEventListener("dragleave", (event) => {
      if (!elements.messagesWrap.contains(event.relatedTarget)) elements.messagesWrap.classList.remove("drop-ready");
    });
    elements.messagesWrap.addEventListener("drop", (event) => {
      event.preventDefault();
      elements.messagesWrap.classList.remove("drop-ready");
      stageFile(event.dataTransfer?.files?.[0]);
    });
    $("#cancel-reply").addEventListener("click", clearReply);
    $("#emoji-toggle").addEventListener("click", () => {
      elements.emojiPicker.hidden = !elements.emojiPicker.hidden;
    });
    $("#record-button").addEventListener("click", recordVoice);
    $("#cancel-recording").addEventListener("click", cancelRecording);
    $("#stop-recording").addEventListener("click", stopRecording);
    $("#discard-recording").addEventListener("click", () => {
      state.recordingBlob = null;
      $("#recording-audio").removeAttribute("src");
      elements.recordingPreview.hidden = true;
    });
    $("#send-recording").addEventListener("click", sendRecording);
    $("#profile-button").addEventListener("click", () => {
      elements.profileMenu.hidden = !elements.profileMenu.hidden;
    });
    elements.profileMenu.addEventListener("click", (event) => {
      const action = event.target.closest("[data-profile-action]")?.dataset.profileAction;
      elements.profileMenu.hidden = true;
      if (action === "rename" && state.user) changeName();
      if (action === "signout") leaveChat();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".chat-account")) elements.profileMenu.hidden = true;
      if (!event.target.closest(".composer")) elements.emojiPicker.hidden = true;
    });
    $("#mobile-channels-toggle").addEventListener("click", () => toggleDrawer("channels"));
    $("#mobile-members-toggle").addEventListener("click", () => toggleDrawer("members"));
    $("#drawer-scrim").addEventListener("click", () => {
      elements.frame.classList.remove("channels-open", "members-open");
      $("#drawer-scrim").hidden = true;
    });
    $("#offline-toggle").addEventListener("click", () => {
      state.collapsedOffline = !state.collapsedOffline;
      elements.offlineMembers.classList.toggle("is-collapsed", state.collapsedOffline);
      $("#offline-toggle b").textContent = state.collapsedOffline ? "⌄" : "⌃";
    });
    $("#member-search").addEventListener("input", renderMemberList);
    $("#members-refresh").addEventListener("click", loadMembers);
    $("#add-channel").addEventListener("click", addChannel);
    $("#edit-notice").addEventListener("click", setNotice);
    $("#notice-edit-icon").addEventListener("click", setNotice);
    $("#server-tools").addEventListener("click", (event) => {
      const action = event.target.closest("[data-server-action]")?.dataset.serverAction;
      if (action === "notice") setNotice();
      if (action === "channel") addChannel();
      if (action === "audit") showAudit();
    });
    $("#lightbox-close").addEventListener("click", () => { $("#lightbox").hidden = true; });
    $("#lightbox").addEventListener("click", (event) => {
      if (event.target.id === "lightbox") event.currentTarget.hidden = true;
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        $("#lightbox").hidden = true;
        elements.profileMenu.hidden = true;
        elements.emojiPicker.hidden = true;
        elements.frame.classList.remove("channels-open", "members-open");
        $("#drawer-scrim").hidden = true;
      }
    });
    window.addEventListener("beforeunload", () => {
      state.eventSource?.close();
      if (state.recorderStream) releaseMicrophone();
    });
  }

  async function initialize() {
    populateEmojiPicker();
    bindEvents();
    await startSession();
    if (state.user) {
      await loadChannels();
      renderChannels();
    }
  }

  initialize();
})();
