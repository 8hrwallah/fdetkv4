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
      return result;
    },
  });

  // Scramjet stringifies the history URL argument, so replaceState(state, "", undefined)
  // or null navigates to ".../undefined". Native browsers keep the current URL instead.
  function installHistoryCompat() {
    var proto = window.History && window.History.prototype;
    if (!proto) return;
    ["pushState", "replaceState"].forEach(function (name) {
      var original = proto[name];
      if (typeof original !== "function") return;
      proto[name] = function (state, title, url) {
        if (url == null) return original.call(this, state, title, window.location.href);
        return original.apply(this, arguments);
      };
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
        if (typeof original !== "function") return;
        proto[name] = function (selector) {
          var rewritten = withEncodedSlashes(selector);
          return rewritten === selector ? original.apply(this, arguments) : original.call(this, rewritten);
        };
      });
    });
  }
})();
