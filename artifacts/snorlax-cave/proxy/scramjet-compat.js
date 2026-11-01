// Appended to Scramjet's controller.inject.js (see vite.config.ts). It runs inside
// every proxied document and works around behaviour in Scramjet 2.0.67-alpha.2.
(function () {
  var controller = typeof $scramjetController === "object" ? $scramjetController : undefined;
  if (!controller || typeof controller.load !== "function" || controller.__snorlaxCompat) return;


  // The controller's exports are getter-only, so swap the global for a wrapper object.
  var load = controller.load;
  $scramjetController = Object.assign({}, controller, {
    __snorlaxCompat: true,
    load: function () {
      var result = load.apply(controller, arguments);
      try {
        installHistoryCompat();
        installSelectorCompat();
      } catch (error) {
        console.warn("Snorlax proxy compatibility shim failed:", error);
      }
      // Scramjet may install its iframe traps after load() returns, so wrap on top of them.
      try {
        installBlankFrameCompat();
        Promise.resolve(result).then(installBlankFrameCompat, function () {});
      } catch (error) {
        console.warn("Snorlax proxy compatibility shim failed:", error);
      }
      return result;
    },
  });

  // Scramjet stringifies the history URL argument, so replaceState(state, "", undefined)
  // or null navigates to ".../undefined". Native browsers keep the current URL instead.
  function wrapHistoryMethod(holder, name) {
    var original = holder[name];
    // Idempotent: load() may run more than once per document, and wrappers must not stack.
    if (typeof original !== "function" || original.__snorlaxCompat) return;
    var wrapped = function (state, title, url) {
      if (url == null) return original.call(this, state, title, window.location.href);
      return original.apply(this, arguments);
    };
    wrapped.__snorlaxCompat = true;
    holder[name] = wrapped;
  }

  function installHistoryCompat() {
    var proto = window.History && window.History.prototype;
    var instance = window.history;
    ["pushState", "replaceState"].forEach(function (name) {
      if (proto) wrapHistoryMethod(proto, name);
      // Scramjet's init hooks (run inside load) may have assigned wrappers directly on the
      // history object, which shadow the prototype, so wrap those own properties as well.
      if (instance && Object.prototype.hasOwnProperty.call(instance, name)) wrapHistoryMethod(instance, name);
    });
  }

  // TikTok's security SDK finds its own script with script[src*="/secsdk_runtime_bundler"].
  // Scramjet stores a percent-encoded proxy URL in the attribute, so those slashes never match.
  var attributeValue = /(\[\s*(?:src|href)\s*[*^$|~]?=\s*)(["'])([^"']*)\2/gi;
  function withEncodedSlashes(selector) {
    if (typeof selector !== "string" || selector.indexOf("/") === -1) return selector;
    var encoded = selector.replace(attributeValue, function (_match, head, quote, value) {
      return head + quote + value.replace(/\//g, "%2F") + quote;
    });
    return encoded === selector ? selector : selector + "," + encoded;
  }

  function installSelectorCompat() {
    [window.Document, window.Element, window.DocumentFragment].forEach(function (ctor) {
      var proto = ctor && ctor.prototype;
      if (!proto) return;
      ["querySelector", "querySelectorAll"].forEach(function (name) {
        var original = proto[name];
        if (typeof original !== "function" || original.__snorlaxCompat) return;
        var wrapped = function (selector) {
          var rewritten = withEncodedSlashes(selector);
          return rewritten === selector ? original.apply(this, arguments) : original.call(this, rewritten);
        };
        wrapped.__snorlaxCompat = true;
        proto[name] = wrapped;
      });
    });
  }

  // Chrome does not give the service worker requests made from an about:blank iframe, so the
  // proxied URLs Scramjet produces there reach the origin server and 404. Cloudflare's JSD
  // snippet injects its script into such a hidden iframe. Same-origin about:blank frames
  // therefore send scripts, fetch and XHR through this (service-worker-controlled) document.
  var nativeScriptSrc;
  var nativeCreateObjectUrl;
  var nativeRevokeObjectUrl;
  var preparedFrames = typeof WeakSet === "function" ? new WeakSet() : null;

  // Scramjet fakes document.URL, so detect an initial about:blank frame from the element.
  function isBlankFrameElement(frame) {
    if (frame.hasAttribute("srcdoc")) return false;
    var src = frame.getAttribute("src");
    return !src || src === "about:blank";
  }

  function isModuleScript(node) {
    return String(node.type || "").toLowerCase() === "module";
  }

  function loadScriptThroughParent(node, insert) {
    var url;
    try {
      url = node.src;
    } catch (_error) {
      return false;
    }
    if (!url || !/^https?:/i.test(url) || isModuleScript(node)) return false;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      insert();
    }
    window
      .fetch(url, { credentials: "include" })
      .then(function (response) {
        if (!response.ok) throw new Error("status " + response.status);
        return response.text();
      })
      .then(function (code) {
        var blobUrl = nativeCreateObjectUrl(new Blob([code], { type: "text/javascript" }));
        var release = function () {
          nativeRevokeObjectUrl(blobUrl);
        };
        node.addEventListener("load", release, { once: true });
        node.addEventListener("error", release, { once: true });
        nativeScriptSrc.set.call(node, blobUrl);
        finish();
      })
      .catch(finish);
    return true;
  }

  function wrapInsertion(win, name) {
    var proto = win.Node && win.Node.prototype;
    var original = proto && proto[name];
    if (typeof original !== "function" || original.__snorlaxCompat) return;
    var wrapped = function (node) {
      var self = this;
      var args = arguments;
      var isScript;
      try {
        isScript = node && node.nodeName === "SCRIPT" && node.src;
      } catch (_error) {
        isScript = false;
      }
      if (isScript && preparedFrames && preparedFrames.has(win)) {
        var deferred = loadScriptThroughParent(node, function () {
          original.apply(self, args);
        });
        if (deferred) return node;
      }
      return original.apply(this, arguments);
    };
    wrapped.__snorlaxCompat = true;
    proto[name] = wrapped;
  }

  function prepareBlankFrame(win, frame) {
    if (!win || !preparedFrames || preparedFrames.has(win) || !isBlankFrameElement(frame)) return;
    preparedFrames.add(win);
    wrapInsertion(win, "appendChild");
    wrapInsertion(win, "insertBefore");
    win.fetch = function () {
      return window.fetch.apply(window, arguments);
    };
    win.XMLHttpRequest = window.XMLHttpRequest;
  }

  function installBlankFrameCompat() {
    if (typeof HTMLIFrameElement === "undefined" || typeof HTMLScriptElement === "undefined") return;
    // Captured before the wrappers below exist so Scramjet's hooks are not involved.
    nativeScriptSrc = nativeScriptSrc || Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
    nativeCreateObjectUrl = nativeCreateObjectUrl || URL.createObjectURL.bind(URL);
    nativeRevokeObjectUrl = nativeRevokeObjectUrl || URL.revokeObjectURL.bind(URL);
    ["contentWindow", "contentDocument"].forEach(function (name) {
      var descriptor = Object.getOwnPropertyDescriptor(window.HTMLIFrameElement.prototype, name);
      if (!descriptor || !descriptor.get || descriptor.get.__snorlaxCompat) return;
      var getter = function () {
        var value = descriptor.get.call(this);
        try {
          prepareBlankFrame(name === "contentWindow" ? value : value && value.defaultView, this);
        } catch (_error) {
          // Cross-origin frame: nothing to prepare.
        }
        return value;
      };
      getter.__snorlaxCompat = true;
      Object.defineProperty(window.HTMLIFrameElement.prototype, name, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: getter,
      });
    });
  }
})();
