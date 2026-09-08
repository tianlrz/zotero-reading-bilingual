/* eslint-disable no-undef */

var chromeHandle;

function install(data, reason) {}

async function startup(data, reason) {
  let { id, version, resourceURI, rootURI } = data || {};
  await Zotero.initializationPromise;

  if (!rootURI) {
    rootURI = resourceURI ? resourceURI.spec : "";
  }

  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "readingbilingual", rootURI + "content/"],
  ]);

  const ctx = {
    rootURI,
  };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}content/scripts/reading-bilingual.js`,
    ctx
  );

  globalThis.readingBilingualContext = ctx;
  Zotero.ReadingBilingual = ctx.ReadingBilingual;

  if (Zotero.ReadingBilingual?.init) {
    Zotero.ReadingBilingual.init(rootURI);
  }

  for (let win of Zotero.getMainWindows()) {
    try {
      Zotero.ReadingBilingual?.onMainWindowLoad(win);
    } catch (e) {
      Zotero.logError(e);
    }
  }
}

async function onMainWindowLoad({ window }, reason) {
  Zotero.ReadingBilingual?.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  Zotero.ReadingBilingual?.onMainWindowUnload(window);
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports
    ).wrappedJSObject;
  }

  try {
    Zotero.ReadingBilingual?.shutdown();
  } catch (e) {
    Zotero.logError(e);
  }

  try {
    Cc["@mozilla.org/intl/stringbundle;1"]
      .getService(Components.interfaces.nsIStringBundleService)
      .flushBundles();
  } catch (e) {}

  let rootURI = data?.rootURI || data?.resourceURI?.spec;
  if (rootURI) {
    try {
      Cu.unload(`${rootURI}content/scripts/reading-bilingual.js`);
    } catch (e) {}
  }

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }

  delete globalThis.readingBilingualContext;
  delete Zotero.ReadingBilingual;
}

function uninstall(data, reason) {}
