function getSelectedProxyEngine() {
    return localStorage.getItem('proxyEngine') === 'scramjet' ? 'scramjet' : 'uv';
}

function waitForActiveServiceWorker(registration, timeoutMs = 15000) {
    if (registration.active) return Promise.resolve(registration.active);

    const worker = registration.installing || registration.waiting;
    if (!worker) {
        return Promise.reject(new Error('No proxy service worker is available'));
    }

    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            worker.removeEventListener('statechange', onStateChange);
            reject(new Error('The proxy service worker did not activate in time'));
        }, timeoutMs);

        function finish(callback, value) {
            window.clearTimeout(timeout);
            worker.removeEventListener('statechange', onStateChange);
            callback(value);
        }

        function onStateChange() {
            if (worker.state === 'activated') {
                finish(resolve, registration.active || worker);
            } else if (worker.state === 'redundant') {
                finish(reject, new Error('The proxy service worker became redundant'));
            }
        }

        worker.addEventListener('statechange', onStateChange);
        onStateChange();
    });
}

async function waitForProxyServiceWorker() {
    if (!window.navigator.serviceWorker) {
        throw new Error('This browser does not support service workers');
    }
    if (!window.__uv$config?.prefix || typeof window.__uv$config.encodeUrl !== 'function') {
        throw new Error('UV configuration did not load');
    }

    const registration = await window.navigator.serviceWorker.register('/sw.js', {
        scope: window.__uv$config.prefix,
        updateViaCache: 'none'
    });

    await waitForActiveServiceWorker(registration);
}

async function openProxyTarget(value) {
    const target = new URL(value, window.location.href);
    const engine = getSelectedProxyEngine();
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error('Only HTTP and HTTPS websites can be opened in the proxy');
    }

    if (target.hostname === 'nvidia.com' || target.hostname.endsWith('.nvidia.com')) {
        window.location.assign(target.href);
        return;
    }

    if (engine === 'uv') {
        await waitForProxyServiceWorker();
        localStorage.setItem('encodedUrl', window.__uv$config.encodeUrl(target.href));
    } else {
        localStorage.removeItem('encodedUrl');
    }

    localStorage.removeItem('agUrl');
    localStorage.setItem('proxyEngine', engine);
    localStorage.setItem('proxyTargetUrl', target.href);
    window.location.assign('/portal');
}

async function apps(url) {
    try {
        await openProxyTarget(url);
    } catch (error) {
        console.error('Unable to open proxied app:', error);
    }
}

document.addEventListener('click', (event) => {
        const link = event.target.closest('a[href="#"]');
        if (link) event.preventDefault();
});
  
  function openLink(url) {
        const target = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url);

        if (target.hostname === 'play.geforcenow.com') {
            window.location.assign(target.href);
            return;
        }

        if (target.hostname === 'nvidia.com' || target.hostname.endsWith('.nvidia.com')) {
            window.location.assign(target.href);
            return;
        }

        apps(target.href);
  }
  
  function ourDiscord() {
      window.location.href = 'https://discord.gg/snorlaxscave';
  }
  
  
  function patreon() {
      window.location.href = 'https://patreon.com/SnorlaxCave';
  }
  
  function email() {
      window.location.href = 'birdy@snorlaxscave.site';
  }
  
  function ourgithub() {
      window.location.href = 'https://github.com/Snorlaxs-Cave/Snorlaxs-Cave-v2';
  }
  
  function bgChange(color) {
      localStorage.setItem("color", color)
      window.location = window.location
  }
  
  function setImageBackground() {
      var url = document.getElementById('imageUrl').value;
      localStorage.setItem("backgroundImage", url);
      window.location.reload();
  }
  function setName() {
      const input = document.getElementById('name');
      const newTabName = input.value;
  
      document.title = newTabName;
      localStorage.setItem('tabName', newTabName);
    }
function cloak() {
    let url = window.location.href;
    var w = window.open("about:blank", "_blank");
    w.document.write('<iframe style="position: absolute;top: 0px;bottom: 0px;right: 0px;width: 100%;border: none;margin: 0;padding: 0;overflow: hidden;z-index: 99999;height: 100%;" src="' + url + '"></iframe>');
    window.close('', '_parent', '');
}
