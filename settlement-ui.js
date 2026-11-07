/* PSulit Cash Log movement options are rendered by the main app bundle.
 * Intentionally no automatic receivable/payable outstanding panels or fetch interception.
 * Adds one small link to the simplified Cash Log page (/log.html), which also opens the Interbranch page.
 */
(function () {
  function addLink() {
    if (document.getElementById("ib-link") || /^\/(interbranch|log)/.test(location.pathname)) return;
    var a = document.createElement("a");
    a.id = "ib-link"; a.href = "/"; a.textContent = "☰ Simple Cash Log";
    a.setAttribute("style", "position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9999;background:#08783f;color:#fff;font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:9px 13px;border-radius:999px;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.25);opacity:.92");
    document.body.appendChild(a);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addLink); else addLink();
})();
